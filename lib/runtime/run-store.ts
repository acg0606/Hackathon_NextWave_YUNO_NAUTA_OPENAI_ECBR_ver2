import { getDemoRunPreset, type DemoRunPreset } from '@/lib/demo/muebles-del-sur-operation';
import { flowForDemoPhase } from '@/lib/flows/muebles-del-sur';
import type {
  ConnectorState,
  FlowDefinition,
  FlowMutation,
  HumanAction,
  JsonObject,
  JsonValue,
  RunEvent,
  RunSnapshot,
  RuntimeArtifact,
  RuntimeFinding,
  TruthClassification,
} from './contracts';
import { FlowEngine, type EngineEmission, type RunExecutionContext } from './flow-engine';
import { sanitizePublicEvent } from './public-events';
import { initialRunSnapshot, reduceRunEvent } from './reducer';
import {
  flowDefinitionSchema,
  flowMutationSchema,
  humanActionSchema,
  jsonObjectSchema,
  runSnapshotSchema,
} from './schemas';
import { compileRuntimeUI } from './ui-compiler';

export class RunNotFoundError extends Error {
  readonly status = 404;
}

export class RunConflictError extends Error {
  readonly status = 409;
}

export class RunInputError extends Error {
  readonly status = 400;
}

export type CreateRunInput = {
  flow?: FlowDefinition;
  demoId?: DemoRunPreset['id'];
  seed?: JsonObject;
  label?: string;
};

export type StoredRun = {
  flow: FlowDefinition;
  snapshot: RunSnapshot;
  events: RunEvent[];
  label: string;
};

export type RunListItem = {
  runId: string;
  label: string;
  flowId: string;
  flowVersion: number;
  status: RunSnapshot['status'];
  revision: number;
  currentStepId: string | null;
  updatedAt: string;
};

type MutableRecord = StoredRun & {
  listeners: Set<(event: RunEvent) => void>;
  queue: Promise<void>;
};

export interface RunStore {
  createRun(input?: CreateRunInput): Promise<StoredRun>;
  listRuns(): RunListItem[];
  getRun(runId: string): StoredRun;
  appendEvent(runId: string, emission: EngineEmission): Promise<RunEvent>;
  getEventsAfter(runId: string, sequence: number): RunEvent[];
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void;
  mutateFlow(runId: string, mutation: FlowMutation): Promise<StoredRun>;
  submitAction(runId: string, action: HumanAction): Promise<StoredRun>;
}

function cloneStored(record: MutableRecord): StoredRun {
  return {
    flow: structuredClone(record.flow),
    snapshot: structuredClone(record.snapshot),
    events: structuredClone(record.events),
    label: record.label,
  };
}

function truthForSeed(key: string, value: JsonValue): TruthClassification {
  if (key === 'historicalEvidence') return 'HISTORICAL_FACT';
  const object = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
  const classification = object?.classification;
  if (
    classification === 'HISTORICAL_FACT' ||
    classification === 'LIVE_CURRENT_CONTEXT' ||
    classification === 'EXTERNAL_SANDBOX' ||
    classification === 'SIMULATED_IF_TODAY' ||
    classification === 'MOCK_CONNECTOR' ||
    classification === 'UNKNOWN'
  ) {
    return classification;
  }
  return 'SIMULATED_IF_TODAY';
}

function asSeedObject(value: JsonValue): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function directSuccessors(flow: FlowDefinition, stepId: string) {
  const step = flow.steps.find((candidate) => candidate.id === stepId);
  return [
    ...(step?.transitions ?? []).map((transition) => transition.toStepId),
    ...flow.transitions
      .filter((transition) => transition.fromStepId === stepId)
      .map((transition) => transition.toStepId),
  ].filter((target): target is string => Boolean(target));
}

function downstreamStepIds(flow: FlowDefinition, stepId: string) {
  const downstream = new Set<string>();
  const queue = directSuccessors(flow, stepId);
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate || candidate === stepId || downstream.has(candidate)) continue;
    downstream.add(candidate);
    queue.push(...directSuccessors(flow, candidate));
  }
  return [...downstream];
}

function payloadEntityId(event: RunEvent, key: string, idKey: string) {
  const entity = asSeedObject(event.payload[key]);
  const id = entity?.[idKey];
  return typeof id === 'string' ? id : null;
}

function latestArtifactProducer(events: RunEvent[], artifactId: string) {
  return events.findLast(
    (event) =>
      event.type === 'artifact.upserted' &&
      payloadEntityId(event, 'artifact', 'id') === artifactId,
  )?.stepId;
}

function latestConnectorProducer(events: RunEvent[], connectorId: string) {
  return events.findLast(
    (event) =>
      (event.type === 'connector.call.started' ||
        event.type === 'connector.call.completed' ||
        event.type === 'connector.call.failed') &&
      payloadEntityId(event, 'connectorState', 'connectorId') === connectorId,
  )?.stepId;
}

function latestFindingProducer(events: RunEvent[], findingId: string) {
  return events.findLast(
    (event) =>
      event.type === 'finding.recorded' &&
      payloadEntityId(event, 'finding', 'id') === findingId,
  )?.stepId;
}

function latestAgentSummaryProducer(events: RunEvent[]) {
  return events.findLast((event) => event.type === 'agent.summary.updated')?.stepId;
}

function canReachDocumentPreparation(flow: FlowDefinition) {
  const pending = [flow.entryStepId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const stepId = pending.shift();
    if (!stepId || visited.has(stepId)) continue;
    visited.add(stepId);
    const step = flow.steps.find((candidate) => candidate.id === stepId);
    if (
      step?.capabilities.includes('booking.view') &&
      step.capabilities.includes('document.view')
    ) {
      return true;
    }
    pending.push(...directSuccessors(flow, stepId));
  }
  return false;
}

export class InMemoryRunStore implements RunStore {
  private readonly records = new Map<string, MutableRecord>();
  private readonly engine: FlowEngine;

  constructor(engine = new FlowEngine()) {
    this.engine = engine;
  }

  private record(runId: string) {
    const record = this.records.get(runId);
    if (!record) throw new RunNotFoundError(`Run ${runId} was not found.`);
    return record;
  }

  private serialize<T>(record: MutableRecord, operation: () => Promise<T>): Promise<T> {
    const result = record.queue.catch(() => undefined).then(operation);
    record.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private context(runId: string): RunExecutionContext {
    return {
      getFlow: () => this.record(runId).flow,
      getSnapshot: () => this.record(runId).snapshot,
      emit: async (emission) => {
        await this.appendEventUnsafe(runId, emission);
      },
    };
  }

  private async appendEventUnsafe(runId: string, emission: EngineEmission) {
    const record = this.record(runId);
    // Compiler and connector objects may contain optional properties whose
    // value is undefined. Events are a JSON protocol, so normalize through an
    // actual JSON round trip before applying the strict bounded schema.
    const normalizedPayload = JSON.parse(
      JSON.stringify(emission.payload ?? {}),
    ) as unknown;
    const event = sanitizePublicEvent({
      eventId: `evt-${crypto.randomUUID()}`,
      runId,
      sequence: record.snapshot.lastSequence + 1,
      revision: record.snapshot.revision + 1,
      timestamp: new Date().toISOString(),
      type: emission.type,
      ...(emission.stepId ? { stepId: emission.stepId } : {}),
      payload: jsonObjectSchema.parse(normalizedPayload) as JsonObject,
      truth: emission.truth ?? 'SIMULATED_IF_TODAY',
    });
    record.snapshot = reduceRunEvent(record.snapshot, event);
    record.events.push(event);
    for (const listener of record.listeners) {
      try {
        listener(structuredClone(event));
      } catch {
        // A failed subscriber never interrupts the authoritative run.
      }
    }
    return event;
  }

  async createRun(input: CreateRunInput = {}) {
    const preset = getDemoRunPreset(input.demoId);
    const flow = flowDefinitionSchema.parse(
      input.flow ?? flowForDemoPhase(preset.phase),
    ) as FlowDefinition;
    const seed = jsonObjectSchema.parse(input.seed ?? preset.seed) as JsonObject;
    const runId = `run-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const record: MutableRecord = {
      flow: structuredClone(flow),
      snapshot: initialRunSnapshot(runId, flow, createdAt),
      events: [],
      label: input.label?.slice(0, 160) || preset.name,
      listeners: new Set(),
      queue: Promise.resolve(),
    };
    this.records.set(runId, record);

    try {
      await this.serialize(record, async () => {
        await this.appendEventUnsafe(runId, {
          type: 'run.created',
          payload: { flowId: flow.id, flowVersion: flow.version, createdAt },
        });
        await this.appendEventUnsafe(runId, {
          type: 'flow.loaded',
          payload: { flowId: flow.id, flowVersion: flow.version },
        });

        const deferPreparedDocuments = canReachDocumentPreparation(flow);
        const preparedDocumentInputs: JsonObject = {};

        for (const [id, value] of Object.entries(seed)) {
          if (deferPreparedDocuments && (id === 'booking' || id === 'billOfLading')) {
            preparedDocumentInputs[id] = value;
            continue;
          }
          const truth = truthForSeed(id, value);
          const evidence = asSeedObject(value);
          const artifactValue =
            id === 'historicalEvidence' && evidence
              ? Object.fromEntries(
                  Object.entries(evidence).filter(([key]) => key !== 'sourceUrl'),
                ) as JsonObject
              : value;
          const artifact: RuntimeArtifact = {
            id,
            kind: id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
            value: artifactValue,
            truth,
            revision: record.snapshot.revision + 1,
            updatedAt: new Date().toISOString(),
            ...(id === 'historicalEvidence'
              ? {
                  provenance: {
                    classification: 'HISTORICAL_FACT' as const,
                    sourceTitle:
                      typeof evidence?.sourceTitle === 'string'
                        ? evidence.sourceTitle
                        : undefined,
                    sourceUrl:
                      typeof evidence?.sourceUrl === 'string'
                        ? evidence.sourceUrl
                        : undefined,
                    publicationDate:
                      typeof evidence?.publicationDate === 'string'
                        ? evidence.publicationDate
                        : undefined,
                    eventDate:
                      typeof evidence?.eventDate === 'string'
                        ? evidence.eventDate
                        : undefined,
                    retrievedAt:
                      typeof evidence?.retrievedAt === 'string'
                        ? evidence.retrievedAt
                        : undefined,
                    confidence:
                      typeof evidence?.confidence === 'number'
                        ? evidence.confidence
                        : undefined,
                  },
                }
              : {}),
          };
          await this.appendEventUnsafe(runId, {
            type: 'artifact.upserted',
            payload: { artifact: artifact as unknown as JsonValue },
            truth,
          });
        }

        if (Object.keys(preparedDocumentInputs).length > 0) {
          const draftArtifact: RuntimeArtifact = {
            id: 'bookingPreparationInputs',
            kind: 'booking-preparation-inputs',
            value: preparedDocumentInputs,
            truth: 'SIMULATED_IF_TODAY',
            revision: record.snapshot.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          await this.appendEventUnsafe(runId, {
            type: 'artifact.upserted',
            payload: { artifact: draftArtifact as unknown as JsonValue },
            truth: 'SIMULATED_IF_TODAY',
          });
        }

        await this.engine.advance(this.context(runId), flow.entryStepId);
      });
      return cloneStored(record);
    } catch (error) {
      this.records.delete(runId);
      throw error;
    }
  }

  listRuns(): RunListItem[] {
    return [...this.records.values()]
      .map((record) => ({
        runId: record.snapshot.runId,
        label: record.label,
        flowId: record.snapshot.flowId,
        flowVersion: record.snapshot.flowVersion,
        status: record.snapshot.status,
        revision: record.snapshot.revision,
        currentStepId: record.snapshot.currentStepId,
        updatedAt: record.snapshot.timestamps.updatedAt,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getRun(runId: string) {
    return cloneStored(this.record(runId));
  }

  async appendEvent(runId: string, emission: EngineEmission) {
    const record = this.record(runId);
    return this.serialize(record, () => this.appendEventUnsafe(runId, emission));
  }

  getEventsAfter(runId: string, sequence: number) {
    return this.record(runId).events
      .filter((event) => event.sequence > Math.max(0, sequence))
      .map((event) => structuredClone(event));
  }

  subscribe(runId: string, listener: (event: RunEvent) => void) {
    const record = this.record(runId);
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }

  async mutateFlow(runId: string, input: FlowMutation) {
    const record = this.record(runId);
    return this.serialize(record, async () => {
      const mutation = flowMutationSchema.parse(input) as FlowMutation;
      const snapshotBeforeMutation = structuredClone(record.snapshot);
      if (mutation.expectedFlowVersion !== record.flow.version) {
        throw new RunConflictError(
          `Flow version is stale. Expected ${record.flow.version}; received ${mutation.expectedFlowVersion}.`,
        );
      }
      if (record.flow.steps.some((step) => step.id === mutation.step.id)) {
        throw new RunConflictError(`Step ${mutation.step.id} already exists.`);
      }

      const nextFlow = structuredClone(record.flow);
      const afterId = mutation.position.afterStepId;
      const beforeId = mutation.position.beforeStepId;
      if (afterId && beforeId) {
        const declaredAdjacent = directSuccessors(nextFlow, afterId).includes(beforeId);
        if (!declaredAdjacent) {
          throw new RunInputError(
            `The declared position is not adjacent: ${afterId} does not continue to ${beforeId}.`,
          );
        }
      }
      const anchorIndex = afterId
        ? nextFlow.steps.findIndex((step) => step.id === afterId)
        : nextFlow.steps.findIndex((step) => step.id === beforeId);
      if (anchorIndex < 0) throw new RunInputError('The insertion anchor does not exist.');

      const insertedStep = structuredClone(mutation.step);
      let continuation: string | null;
      if (afterId) {
        const predecessor = nextFlow.steps.find((step) => step.id === afterId);
        if (!predecessor) throw new RunInputError('The insertion predecessor does not exist.');
        const localSuccessIndex = predecessor.transitions?.findIndex(
          (transition) => transition.outcome === 'success',
        ) ?? -1;
        const globalSuccessIndex = nextFlow.transitions.findIndex(
          (transition) => transition.fromStepId === afterId && transition.outcome === 'success',
        );
        const declaredContinuation = insertedStep.transitions?.find(
          (transition) => transition.outcome === 'match' || transition.outcome === 'success',
        )?.toStepId;

        if (beforeId) {
          continuation = beforeId;
          let rewired = false;
          if (predecessor.transitions) {
            predecessor.transitions = predecessor.transitions.map((transition) => {
              if (transition.toStepId !== beforeId) return transition;
              rewired = true;
              return { ...transition, toStepId: insertedStep.id };
            });
          }
          for (const transition of nextFlow.transitions) {
            if (transition.fromStepId === afterId && transition.toStepId === beforeId) {
              transition.toStepId = insertedStep.id;
              rewired = true;
            }
          }
          if (!rewired) {
            throw new RunInputError(
              `The declared position is not connected: ${afterId} does not continue to ${beforeId}.`,
            );
          }
        } else {
          continuation =
            (localSuccessIndex >= 0
              ? predecessor.transitions?.[localSuccessIndex]?.toStepId
              : null) ??
            (globalSuccessIndex >= 0 ? nextFlow.transitions[globalSuccessIndex].toStepId : null) ??
            declaredContinuation ??
            null;
          if (localSuccessIndex >= 0 && predecessor.transitions) {
            predecessor.transitions[localSuccessIndex] = {
              ...predecessor.transitions[localSuccessIndex],
              toStepId: insertedStep.id,
            };
          } else if (globalSuccessIndex >= 0) {
            nextFlow.transitions[globalSuccessIndex] = {
              ...nextFlow.transitions[globalSuccessIndex],
              toStepId: insertedStep.id,
            };
          } else {
            nextFlow.transitions.push({
              fromStepId: afterId,
              outcome: 'success',
              toStepId: insertedStep.id,
            });
          }
        }
        nextFlow.steps.splice(anchorIndex + 1, 0, insertedStep);
      } else {
        continuation = beforeId ?? null;
        let rewired = false;
        for (const step of nextFlow.steps) {
          if (!step.transitions) continue;
          step.transitions = step.transitions.map((transition) => {
            if (transition.toStepId !== beforeId) return transition;
            rewired = true;
            return { ...transition, toStepId: insertedStep.id };
          });
        }
        for (const transition of nextFlow.transitions) {
          if (transition.toStepId === beforeId) {
            transition.toStepId = insertedStep.id;
            rewired = true;
          }
        }
        if (nextFlow.entryStepId === beforeId) {
          nextFlow.entryStepId = insertedStep.id;
          rewired = true;
        }
        if (!rewired) {
          throw new RunInputError(`Step ${beforeId} has no inbound transition to rewire.`);
        }
        nextFlow.steps.splice(anchorIndex, 0, insertedStep);
      }

      const hasSuccessContinuation = insertedStep.transitions?.some(
        (transition) => transition.outcome === 'success',
      );
      if (!hasSuccessContinuation) {
        nextFlow.transitions.push({
          fromStepId: insertedStep.id,
          outcome: 'success',
          toStepId: continuation,
        });
      }
      if (
        !insertedStep.transitions?.some((transition) => transition.outcome === 'skipped')
      ) {
        nextFlow.transitions.push({
          fromStepId: insertedStep.id,
          outcome: 'skipped',
          toStepId: continuation,
        });
      }

      nextFlow.version += 1;
      record.flow = flowDefinitionSchema.parse(nextFlow) as FlowDefinition;
      const anchorStepId = afterId ?? beforeId;
      const anchorWasReached = Boolean(
        anchorStepId &&
          (snapshotBeforeMutation.completedStepIds.includes(anchorStepId) ||
            snapshotBeforeMutation.skippedStepIds.includes(anchorStepId) ||
            snapshotBeforeMutation.currentStepId === anchorStepId),
      );
      const shouldExecuteInsertedStep = afterId
        ? anchorWasReached && snapshotBeforeMutation.currentStepId !== afterId
        : Boolean(
            beforeId &&
              (snapshotBeforeMutation.completedStepIds.includes(beforeId) ||
                snapshotBeforeMutation.skippedStepIds.includes(beforeId)),
          );
      const invalidatedStepIds = shouldExecuteInsertedStep
        ? downstreamStepIds(record.flow, insertedStep.id)
        : [];
      const invalidated = new Set(invalidatedStepIds);
      const invalidationReason =
        `Flow version ${record.flow.version} inserted ${insertedStep.title}; ` +
        'results produced by affected downstream steps are stale.';
      const invalidatedArtifactIds = Object.keys(snapshotBeforeMutation.artifacts).filter((artifactId) => {
        const producer = latestArtifactProducer(record.events, artifactId);
        return Boolean(producer && invalidated.has(producer));
      });
      const staleConnectorStates = Object.values(snapshotBeforeMutation.connectorStates).filter((state) => {
        const producer = latestConnectorProducer(record.events, state.connectorId);
        return Boolean(producer && invalidated.has(producer));
      });
      const staleFindings = snapshotBeforeMutation.findings.filter((finding) => {
        const producer = latestFindingProducer(record.events, finding.id);
        return Boolean(producer && invalidated.has(producer));
      });
      const summaryProducer = latestAgentSummaryProducer(record.events);
      const invalidateAgentSummary = Boolean(
        snapshotBeforeMutation.publicAgentSummary &&
          summaryProducer &&
          invalidated.has(summaryProducer),
      );
      await this.appendEventUnsafe(runId, {
        type: 'flow.definition.updated',
        payload: {
          flowId: record.flow.id,
          flowVersion: record.flow.version,
          insertedStepId: insertedStep.id,
          invalidatedStepIds,
          invalidationReason,
        },
      });
      if (invalidateAgentSummary) {
        await this.appendEventUnsafe(runId, {
          type: 'agent.summary.updated',
          payload: {
            summary: {
              summary:
                'The previous agent summary is stale after an upstream flow change; recomputed evidence will replace it.',
              evidence: [invalidationReason],
              selectedAction: 'invalidate-downstream-results',
            },
          },
          truth: 'SIMULATED_IF_TODAY',
        });
      }
      for (const artifactId of invalidatedArtifactIds) {
        const artifact = snapshotBeforeMutation.artifacts[artifactId];
        await this.appendEventUnsafe(runId, {
          type: 'artifact.invalidated',
          payload: { artifactId, reason: invalidationReason },
          truth: artifact?.truth ?? 'SIMULATED_IF_TODAY',
        });
      }
      for (const previous of staleConnectorStates) {
        const connectorState: ConnectorState = {
          ...previous,
          status: 'stale',
          updatedAt: new Date().toISOString(),
          data: {
            ...previous.data,
            stale: true,
            invalidationReason,
          },
        };
        await this.appendEventUnsafe(runId, {
          type: 'connector.call.completed',
          payload: { connectorState: connectorState as unknown as JsonValue },
          truth: connectorState.truth,
        });
      }
      for (const previous of staleFindings) {
        const finding: RuntimeFinding = {
          ...previous,
          severity: 'info',
          title: `Stale: ${previous.title}`.slice(0, 160),
          summary: 'Invalidated after an upstream flow change; this result is no longer used for decisions.',
          details: {
            ...previous.details,
            stale: true,
            invalidationReason,
          },
        };
        await this.appendEventUnsafe(runId, {
          type: 'finding.recorded',
          payload: { finding: finding as unknown as JsonValue },
          truth: finding.truth,
        });
      }
      await this.appendEventUnsafe(runId, {
        type: 'step.discovered',
        stepId: insertedStep.id,
        payload: {
          stepId: insertedStep.id,
          title: insertedStep.title,
          kind: insertedStep.kind,
          capabilities: insertedStep.capabilities,
        },
      });
      if (shouldExecuteInsertedStep) {
        await this.engine.advance(this.context(runId), insertedStep.id);
      } else {
        const current = record.snapshot;
        const uiSpec = compileRuntimeUI(record.flow, current, {
          revision: current.revision + 1,
        });
        await this.appendEventUnsafe(runId, {
          type: 'ui.spec.emitted',
          payload: { uiSpec: uiSpec as unknown as JsonValue },
          truth: 'SIMULATED_IF_TODAY',
        });
      }
      return cloneStored(record);
    });
  }

  async submitAction(runId: string, input: HumanAction) {
    const record = this.record(runId);
    return this.serialize(record, async () => {
      const action = humanActionSchema.parse({ ...input, runId }) as HumanAction;
      if (record.snapshot.processedIdempotencyKeys.includes(action.idempotencyKey)) {
        return cloneStored(record);
      }
      const decision = record.snapshot.pendingDecision;
      if (!decision || record.snapshot.status !== 'awaiting_human') {
        throw new RunConflictError('The run is not awaiting a human decision.');
      }
      if (action.expectedRevision !== record.snapshot.revision) {
        throw new RunConflictError(
          `Run revision is stale. Expected ${record.snapshot.revision}; received ${action.expectedRevision}.`,
        );
      }
      if (action.decisionId !== decision.decisionId) {
        throw new RunConflictError('The decision is stale or no longer available.');
      }
      if (!decision.actions.some((candidate) => candidate.actionId === action.actionId)) {
        throw new RunInputError(`Action ${action.actionId} is not allowed for this decision.`);
      }
      await this.engine.resume(this.context(runId), action);
      return cloneStored(record);
    });
  }

  clearForTests() {
    this.records.clear();
  }

  restoreRun(stored: StoredRun, force = false) {
    const validatedFlow = flowDefinitionSchema.parse(stored.flow) as FlowDefinition;
    const validatedSnapshot = runSnapshotSchema.parse(stored.snapshot) as RunSnapshot;
    const existing = this.records.get(validatedSnapshot.runId);
    if (!force && existing && existing.snapshot.revision >= validatedSnapshot.revision) return;
    this.records.set(validatedSnapshot.runId, {
      flow: structuredClone(validatedFlow),
      snapshot: structuredClone(validatedSnapshot),
      events: structuredClone(stored.events),
      label: stored.label.slice(0, 160),
      listeners: existing?.listeners ?? new Set(),
      queue: existing?.queue ?? Promise.resolve(),
    });
  }
}

const globalStore = globalThis as typeof globalThis & {
  __routeShiftRunStore?: InMemoryRunStore;
};

export const runStore =
  globalStore.__routeShiftRunStore ?? (globalStore.__routeShiftRunStore = new InMemoryRunStore());

export function snapshotForResponse(snapshot: RunSnapshot) {
  return runSnapshotSchema.parse(structuredClone(snapshot)) as RunSnapshot;
}
