import type {
  FlowDefinition,
  JsonObject,
  JsonValue,
  RunEvent,
  RunSnapshot,
} from './contracts';
import {
  connectorStateSchema,
  flowDefinitionSchema,
  pendingDecisionSchema,
  publicAgentSummarySchema,
  runEventSchema,
  runSnapshotSchema,
  runtimeArtifactSchema,
  runtimeFindingSchema,
  runtimeUISpecSchema,
} from './schemas';

function addUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function removeValues(values: string[], removed: Set<string>): string[] {
  return values.filter((value) => !removed.has(value));
}

function payloadString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function payloadInteger(payload: JsonObject, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined;
}

function payloadStringArray(payload: JsonObject, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function eventStepId(event: RunEvent): string | undefined {
  return event.stepId ?? payloadString(event.payload, 'stepId');
}

export function initialRunSnapshot(
  runId: string,
  flow: FlowDefinition,
  createdAt = new Date().toISOString(),
): RunSnapshot {
  const validatedFlow = flowDefinitionSchema.parse(flow);
  return runSnapshotSchema.parse({
    runId,
    flowId: validatedFlow.id,
    flowVersion: validatedFlow.version,
    revision: 0,
    lastSequence: 0,
    status: 'queued',
    currentStepId: null,
    completedStepIds: [],
    skippedStepIds: [],
    pendingDecision: null,
    artifacts: {},
    findings: [],
    connectorStates: {},
    publicAgentSummary: null,
    timestamps: {
      createdAt,
      updatedAt: createdAt,
    },
    latestUISpec: null,
    processedEventIds: [],
    processedIdempotencyKeys: [],
  }) as RunSnapshot;
}

export function reduceRunEvent(
  snapshot: RunSnapshot,
  event: RunEvent,
): RunSnapshot {
  const current = runSnapshotSchema.parse(snapshot) as RunSnapshot;
  const validatedEvent = runEventSchema.parse(event) as RunEvent;

  if (validatedEvent.runId !== current.runId) {
    throw new Error(
      `Cannot reduce event for run ${validatedEvent.runId} into run ${current.runId}`,
    );
  }

  if (current.processedEventIds.includes(validatedEvent.eventId))
    return current;

  const expectedSequence = current.lastSequence + 1;
  if (validatedEvent.sequence !== expectedSequence) {
    throw new Error(
      `Event sequence gap for run ${current.runId}: expected ${expectedSequence}, received ${validatedEvent.sequence}`,
    );
  }
  if (validatedEvent.revision < current.revision) {
    throw new Error(
      `Event revision moved backwards for run ${current.runId}: current ${current.revision}, received ${validatedEvent.revision}`,
    );
  }
  if (current.processedEventIds.length >= 4_096) {
    throw new Error(
      `Run ${current.runId} exceeded the bounded event replay window`,
    );
  }

  const next = structuredClone(current) as RunSnapshot;
  next.lastSequence = validatedEvent.sequence;
  next.revision = validatedEvent.revision;
  next.timestamps.updatedAt = validatedEvent.timestamp;
  next.processedEventIds.push(validatedEvent.eventId);

  const stepId = eventStepId(validatedEvent);

  switch (validatedEvent.type) {
    case 'run.created': {
      const flowId = payloadString(validatedEvent.payload, 'flowId');
      const flowVersion = payloadInteger(validatedEvent.payload, 'flowVersion');
      const createdAt = payloadString(validatedEvent.payload, 'createdAt');
      if (flowId) next.flowId = flowId;
      if (flowVersion && flowVersion > 0) next.flowVersion = flowVersion;
      if (createdAt) next.timestamps.createdAt = createdAt;
      next.status = 'running';
      break;
    }
    case 'flow.loaded': {
      const flowId = payloadString(validatedEvent.payload, 'flowId');
      const flowVersion = payloadInteger(validatedEvent.payload, 'flowVersion');
      if (flowId) next.flowId = flowId;
      if (flowVersion && flowVersion > 0) next.flowVersion = flowVersion;
      next.status = 'running';
      break;
    }
    case 'flow.definition.updated': {
      const flowVersion = payloadInteger(validatedEvent.payload, 'flowVersion');
      if (!flowVersion || flowVersion <= next.flowVersion) {
        throw new Error('A flow update must increase flowVersion');
      }
      next.flowVersion = flowVersion;
      const invalidated = new Set(
        payloadStringArray(validatedEvent.payload, 'invalidatedStepIds'),
      );
      next.completedStepIds = removeValues(next.completedStepIds, invalidated);
      next.skippedStepIds = removeValues(next.skippedStepIds, invalidated);
      const currentWasInvalidated = Boolean(
        next.currentStepId && invalidated.has(next.currentStepId),
      );
      if (currentWasInvalidated) {
        next.currentStepId = null;
        next.pendingDecision = null;
        next.status = 'running';
      } else if (invalidated.size > 0 && next.status === 'completed') {
        next.status = 'running';
        next.timestamps.completedAt = undefined;
      }
      next.latestUISpec = null;
      break;
    }
    case 'step.started': {
      if (!stepId) throw new Error('step.started requires a stepId');
      next.currentStepId = stepId;
      next.status = 'running';
      break;
    }
    case 'step.skipped': {
      if (!stepId) throw new Error('step.skipped requires a stepId');
      next.skippedStepIds = addUnique(next.skippedStepIds, stepId);
      if (next.currentStepId === stepId) next.currentStepId = null;
      break;
    }
    case 'step.completed': {
      if (!stepId) throw new Error('step.completed requires a stepId');
      next.completedStepIds = addUnique(next.completedStepIds, stepId);
      next.skippedStepIds = next.skippedStepIds.filter((id) => id !== stepId);
      if (next.currentStepId === stepId) next.currentStepId = null;
      break;
    }
    case 'step.failed': {
      if (next.currentStepId === stepId) next.currentStepId = null;
      break;
    }
    case 'artifact.upserted': {
      const artifact = runtimeArtifactSchema.parse(
        validatedEvent.payload.artifact,
      );
      next.artifacts[artifact.id] = structuredClone(artifact);
      break;
    }
    case 'artifact.invalidated': {
      const artifactId = payloadString(validatedEvent.payload, 'artifactId');
      if (!artifactId)
        throw new Error('artifact.invalidated requires artifactId');
      delete next.artifacts[artifactId];
      break;
    }
    case 'connector.call.started':
    case 'connector.call.completed':
    case 'connector.call.failed': {
      const connectorState = connectorStateSchema.parse(
        validatedEvent.payload.connectorState,
      );
      next.connectorStates[connectorState.connectorId] =
        structuredClone(connectorState);
      break;
    }
    case 'agent.summary.updated': {
      next.publicAgentSummary = publicAgentSummarySchema.parse(
        validatedEvent.payload.summary,
      );
      break;
    }
    case 'finding.recorded': {
      const finding = runtimeFindingSchema.parse(
        validatedEvent.payload.finding,
      );
      const existingIndex = next.findings.findIndex(
        (item) => item.id === finding.id,
      );
      if (existingIndex === -1) next.findings.push(structuredClone(finding));
      else next.findings[existingIndex] = structuredClone(finding);
      break;
    }
    case 'decision.requested': {
      next.pendingDecision = pendingDecisionSchema.parse(
        validatedEvent.payload.decision,
      );
      break;
    }
    case 'run.awaiting_human': {
      if (!next.pendingDecision) {
        throw new Error('run.awaiting_human requires a pending decision');
      }
      next.status = 'awaiting_human';
      break;
    }
    case 'human.action.received': {
      const idempotencyKey = payloadString(
        validatedEvent.payload,
        'idempotencyKey',
      );
      if (!idempotencyKey)
        throw new Error('human.action.received requires idempotencyKey');
      if (next.processedIdempotencyKeys.includes(idempotencyKey)) break;
      next.processedIdempotencyKeys = addUnique(
        next.processedIdempotencyKeys,
        idempotencyKey,
      );
      next.pendingDecision = null;
      next.status = 'running';
      break;
    }
    case 'run.resumed': {
      next.pendingDecision = null;
      next.status = 'running';
      break;
    }
    case 'ui.spec.emitted': {
      const uiSpec = runtimeUISpecSchema.parse(validatedEvent.payload.uiSpec);
      if (uiSpec.runId !== next.runId)
        throw new Error('UI spec runId does not match its event');
      if (uiSpec.revision !== validatedEvent.revision) {
        throw new Error('UI spec revision does not match its event');
      }
      next.latestUISpec = structuredClone(uiSpec);
      break;
    }
    case 'run.completed': {
      next.status = 'completed';
      next.currentStepId = null;
      next.pendingDecision = null;
      next.timestamps.completedAt = validatedEvent.timestamp;
      break;
    }
    case 'run.failed': {
      next.status = 'failed';
      next.currentStepId = null;
      next.pendingDecision = null;
      next.timestamps.completedAt = validatedEvent.timestamp;
      break;
    }
    case 'run.cancelled': {
      next.status = 'cancelled';
      next.currentStepId = null;
      next.pendingDecision = null;
      next.timestamps.completedAt = validatedEvent.timestamp;
      break;
    }
    case 'step.discovered':
    case 'tool.call.started':
    case 'tool.call.completed':
    case 'tool.call.failed':
      break;
  }

  return runSnapshotSchema.parse(next) as RunSnapshot;
}

function replaySeed(events: readonly RunEvent[]): RunSnapshot {
  const first = runEventSchema.parse(events[0]) as RunEvent;
  if (first.type !== 'run.created') {
    throw new Error(
      'Replay without an initial snapshot must begin with run.created',
    );
  }
  const flowId = payloadString(first.payload, 'flowId');
  const flowVersion = payloadInteger(first.payload, 'flowVersion');
  if (!flowId || !flowVersion || flowVersion < 1) {
    throw new Error(
      'run.created must include flowId and a positive flowVersion',
    );
  }
  const createdAt =
    payloadString(first.payload, 'createdAt') ?? first.timestamp;
  return runSnapshotSchema.parse({
    runId: first.runId,
    flowId,
    flowVersion,
    revision: 0,
    lastSequence: 0,
    status: 'queued',
    currentStepId: null,
    completedStepIds: [],
    skippedStepIds: [],
    pendingDecision: null,
    artifacts: {},
    findings: [],
    connectorStates: {},
    publicAgentSummary: null,
    timestamps: { createdAt, updatedAt: createdAt },
    latestUISpec: null,
    processedEventIds: [],
    processedIdempotencyKeys: [],
  }) as RunSnapshot;
}

export function replayRunEvents(
  events: readonly RunEvent[],
  initialSnapshot?: RunSnapshot,
): RunSnapshot {
  if (events.length === 0) {
    if (!initialSnapshot)
      throw new Error('Cannot replay an empty event stream without a snapshot');
    return runSnapshotSchema.parse(initialSnapshot) as RunSnapshot;
  }
  return events.reduce(
    (snapshot, event) => reduceRunEvent(snapshot, event),
    initialSnapshot
      ? (runSnapshotSchema.parse(initialSnapshot) as RunSnapshot)
      : replaySeed(events),
  );
}

export function eventPayload(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Event payload must be an object');
  }
  return value;
}
