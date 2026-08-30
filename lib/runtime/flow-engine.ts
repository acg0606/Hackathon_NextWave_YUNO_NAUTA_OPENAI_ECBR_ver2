import type { AgentProvider, DocumentComparison } from '@/lib/agent/agent-provider';
import { configuredAgent } from '@/lib/agent/openai-agent';
import { fetchAdsbLolAircraft } from '@/lib/connectors/adsb-lol';
import { collectAISStream } from '@/lib/connectors/aisstream';
import { trackWithNautaMock } from '@/lib/connectors/mock-nauta';
import { quoteWithYunoMock } from '@/lib/connectors/mock-yuno';
import { fetchCurrentEonetContext } from '@/lib/connectors/nasa-eonet';
import { createYunoSandboxClientFromEnv } from '@/lib/connectors/yuno-sandbox';
import { calculateRouteQuote } from '@/lib/pricing/route-quote';
import type {
  AllowedAction,
  ConnectorState,
  FlowDefinition,
  HumanAction,
  JsonObject,
  JsonValue,
  PendingDecision,
  PublicAgentSummary,
  RunEventType,
  RunSnapshot,
  RuntimeArtifact,
  RuntimeFinding,
  StepCondition,
  StepDefinition,
  ToolId,
  TruthClassification,
} from './contracts';
import { compileRuntimeUI } from './ui-compiler';

export type EngineEmission = {
  type: RunEventType;
  payload?: JsonObject;
  stepId?: string;
  truth?: TruthClassification;
};

export type RunExecutionContext = {
  getFlow(): FlowDefinition;
  getSnapshot(): RunSnapshot;
  emit(emission: EngineEmission): Promise<void>;
};

const MAX_AUTOMATIC_STEPS = 96;

export class StepExecutionTimeoutError extends Error {
  constructor(
    readonly stepId: string,
    readonly timeoutMs: number,
  ) {
    super(`Step ${stepId} exceeded its ${timeoutMs} ms execution limit.`);
  }
}

function publicErrorCode(error: unknown) {
  return error instanceof StepExecutionTimeoutError ? 'STEP_TIMEOUT' : 'TOOL_FAILED';
}

function toolTruth(toolId: ToolId): TruthClassification {
  if (toolId === 'nasa.eonet.current-context' || toolId === 'transport.live-context') {
    return 'LIVE_CURRENT_CONTEXT';
  }
  if (toolId.startsWith('yuno.sandbox.')) return 'EXTERNAL_SANDBOX';
  if (toolId.startsWith('route.pricing.')) return 'SIMULATED_IF_TODAY';
  return toolId.startsWith('agent.') ? 'SIMULATED_IF_TODAY' : 'MOCK_CONNECTOR';
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function textValue(value: JsonValue | undefined, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function finiteNumber(value: JsonValue | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function coordinatePair(value: JsonValue | undefined): [number, number] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    value[0] < -180 ||
    value[0] > 180 ||
    value[1] < -90 ||
    value[1] > 90
  ) {
    return null;
  }
  return [value[0], value[1]];
}

function maritimeBoundingBox(destination: string): [[number, number], [number, number]] {
  const normalized = destination.toLowerCase();
  if (normalized.includes('rotterdam')) return [[51.55, 3.65], [52.25, 4.95]];
  if (normalized.includes('atlanta')) return [[31.75, -81.55], [32.55, -80.65]];
  if (normalized.includes('gaziantep')) return [[35.45, 33.75], [37.2, 36.9]];
  return [[30.55, 120.5], [31.95, 122.45]];
}

function transportMode(value: JsonValue | undefined) {
  return value === 'AIR' || value === 'OCEAN' || value === 'OCEAN_ROAD' || value === 'RAIL_OCEAN'
    ? value
    : 'OCEAN_ROAD';
}

function disruption(value: JsonValue | undefined) {
  return value === 'TRANSSHIPMENT' ||
    value === 'ROUTE_INTERRUPTION' ||
    value === 'VISIBILITY_DEGRADED'
    ? value
    : 'NONE';
}

function resolveRuntimePath(snapshot: RunSnapshot, path: string): JsonValue | undefined {
  const segments = path.split('.').filter(Boolean);
  if (!segments.length) return undefined;

  let cursor: JsonValue | undefined;
  if (segments[0] === 'artifacts') {
    const artifactId = segments[1];
    cursor = artifactId ? snapshot.artifacts[artifactId]?.value : undefined;
    segments.splice(0, 2);
  } else {
    const artifact = snapshot.artifacts[segments[0]];
    cursor = artifact?.value;
    segments.splice(0, 1);
  }

  for (const segment of segments) {
    const object = asObject(cursor);
    if (!object) return undefined;
    cursor = object[segment];
  }
  return cursor;
}

function testPredicate(
  snapshot: RunSnapshot,
  predicate: NonNullable<StepCondition['all']>[number],
) {
  const actual = resolveRuntimePath(snapshot, predicate.path);
  switch (predicate.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'equals':
      return Object.is(actual, predicate.value);
    case 'not_equals':
      return !Object.is(actual, predicate.value);
    case 'in':
      return Array.isArray(predicate.value) && predicate.value.includes(actual as never);
    case 'not_in':
      return Array.isArray(predicate.value) && !predicate.value.includes(actual as never);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof actual !== 'number' || typeof predicate.value !== 'number') return false;
      if (predicate.operator === 'gt') return actual > predicate.value;
      if (predicate.operator === 'gte') return actual >= predicate.value;
      if (predicate.operator === 'lt') return actual < predicate.value;
      return actual <= predicate.value;
    }
  }
}

export function evaluateStepCondition(snapshot: RunSnapshot, condition?: StepCondition) {
  if (!condition) return true;
  const all = condition.all?.every((predicate) => testPredicate(snapshot, predicate)) ?? true;
  const any = condition.any?.some((predicate) => testPredicate(snapshot, predicate)) ?? true;
  return all && any;
}

function nextStep(flow: FlowDefinition, step: StepDefinition, outcome: string) {
  const local = step.transitions?.find((transition) => transition.outcome === outcome);
  if (local) return local.toStepId;
  return flow.transitions.find(
    (transition) => transition.fromStepId === step.id && transition.outcome === outcome,
  )?.toStepId;
}

function nowArtifact(
  snapshot: RunSnapshot,
  id: string,
  kind: string,
  value: JsonValue,
  truth: TruthClassification,
  provenance?: RuntimeArtifact['provenance'],
): RuntimeArtifact {
  return {
    id,
    kind,
    value,
    truth,
    revision: snapshot.revision + 1,
    updatedAt: new Date().toISOString(),
    ...(provenance ? { provenance } : {}),
  };
}

function connectorState(
  connectorId: string,
  status: ConnectorState['status'],
  truth: TruthClassification,
  data?: JsonObject,
): ConnectorState {
  return {
    connectorId,
    status,
    truth,
    updatedAt: new Date().toISOString(),
    ...(data ? { data } : {}),
  };
}

function actionsForStep(step: StepDefinition): AllowedAction[] {
  if (step.capabilities.includes('document.compare')) {
    return [
      {
        actionId: 'request-corrected-document',
        label: 'Request corrected B/L',
        intent: 'request-corrected-document',
        requiresConfirmation: true,
      },
      {
        actionId: 'approve-exception',
        label: 'Approve exception',
        intent: 'approve-exception',
        requiresConfirmation: true,
      },
    ];
  }
  return [
    { actionId: 'reroute', label: 'Approve reroute', intent: 'reroute', requiresConfirmation: true },
    { actionId: 'hold', label: 'Hold and monitor', intent: 'hold', requiresConfirmation: true },
    { actionId: 'escalate', label: 'Escalate', intent: 'escalate', requiresConfirmation: true },
  ];
}

export class FlowEngine {
  constructor(private readonly agent: AgentProvider = configuredAgent()) {}

  private async emitUI(context: RunExecutionContext) {
    const current = context.getSnapshot();
    const uiSpec = compileRuntimeUI(context.getFlow(), current, {
      revision: current.revision + 1,
    });
    await context.emit({
      type: 'ui.spec.emitted',
      payload: { uiSpec: uiSpec as unknown as JsonValue },
      truth: 'SIMULATED_IF_TODAY',
    });
  }

  private async complete(context: RunExecutionContext) {
    await context.emit({
      type: 'run.completed',
      payload: { completed: true },
      truth: 'SIMULATED_IF_TODAY',
    });
    await this.emitUI(context);
  }

  private async requestDecision(
    context: RunExecutionContext,
    step: StepDefinition,
    explanation: string,
  ) {
    const expectedRevision = context.getSnapshot().revision + 3;
    const decision: PendingDecision = {
      decisionId: `decision-${crypto.randomUUID()}`,
      title: step.capabilities.includes('document.compare')
        ? 'Resolve blocking document discrepancies'
        : step.title,
      explanation,
      actions: actionsForStep(step),
      expectedRevision,
      requestedAt: new Date().toISOString(),
    };
    await context.emit({
      type: 'decision.requested',
      stepId: step.id,
      payload: { decision: decision as unknown as JsonValue },
      truth: 'SIMULATED_IF_TODAY',
    });
    await context.emit({
      type: 'run.awaiting_human',
      stepId: step.id,
      payload: { decisionId: decision.decisionId },
      truth: 'SIMULATED_IF_TODAY',
    });
    await this.emitUI(context);
  }

  private async compareDocuments(
    context: RunExecutionContext,
    step: StepDefinition,
    signal?: AbortSignal,
  ): Promise<DocumentComparison> {
    signal?.throwIfAborted();
    const snapshot = context.getSnapshot();
    const expectedRef = step.inputRefs?.expected ?? 'artifacts.booking';
    const actualRef = step.inputRefs?.actual ?? 'artifacts.billOfLading';
    const expected = asObject(resolveRuntimePath(snapshot, expectedRef)) ?? {};
    const actual = asObject(resolveRuntimePath(snapshot, actualRef)) ?? {};

    const comparison = await this.agent.compareDocuments(expected, actual);
    signal?.throwIfAborted();
    const artifact = nowArtifact(
      context.getSnapshot(),
      'documentComparison',
      'document-comparison',
      comparison as unknown as JsonValue,
      'MOCK_CONNECTOR',
    );
    await context.emit({
      type: 'artifact.upserted',
      stepId: step.id,
      payload: { artifact: artifact as unknown as JsonValue },
      truth: 'MOCK_CONNECTOR',
    });

    for (const difference of comparison.differences.filter((item) => item.blocking)) {
      const finding: RuntimeFinding = {
        id: `difference-${difference.field}`,
        kind: 'document-discrepancy',
        severity: 'blocking',
        title: `${difference.field} does not match`,
        summary: `Expected ${String(difference.expected)}; received ${String(difference.actual)}.`,
        confidence: comparison.confidence,
        details: {
          field: difference.field,
          expected: difference.expected,
          actual: difference.actual,
          ...(difference.delta === undefined ? {} : { delta: difference.delta }),
          ...(difference.deltaPercent === undefined
            ? {}
            : { deltaPercent: difference.deltaPercent }),
        },
        truth: 'MOCK_CONNECTOR',
      };
      await context.emit({
        type: 'finding.recorded',
        stepId: step.id,
        payload: { finding: finding as unknown as JsonValue },
        truth: 'MOCK_CONNECTOR',
      });
    }

    if (comparison.matches) {
      for (const previous of snapshot.findings.filter(
        (finding) => finding.kind === 'document-discrepancy' && finding.severity === 'blocking',
      )) {
        const resolved: RuntimeFinding = {
          ...previous,
          severity: 'info',
          title: `${previous.title} — resolved`,
          summary: 'The corrected Bill of Lading now matches the booking on this field.',
          details: { ...previous.details, resolved: true },
          confidence: comparison.confidence,
        };
        await context.emit({
          type: 'finding.recorded',
          stepId: step.id,
          payload: { finding: resolved as unknown as JsonValue },
          truth: 'MOCK_CONNECTOR',
        });
      }
    }

    const summary: PublicAgentSummary = {
      summary: comparison.publicSummary,
      evidence: comparison.differences.map(
        (difference) =>
          `${difference.field}: ${String(difference.expected)} → ${String(difference.actual)}`,
      ),
      selectedAction: comparison.recommendedAction,
      confidence: comparison.confidence,
      providerId: 'deterministic-document-compare-v1',
      providerMode: 'deterministic_fallback',
    };
    await context.emit({
      type: 'agent.summary.updated',
      stepId: step.id,
      payload: { summary: summary as unknown as JsonValue },
      truth: 'MOCK_CONNECTOR',
    });
    return comparison;
  }

  private async executeYuno(
    context: RunExecutionContext,
    step: StepDefinition,
    options: {
      proposedMode?: 'AIR' | 'OCEAN' | 'OCEAN_ROAD' | 'RAIL_OCEAN';
      operation?: 'QUOTE' | 'REQUOTE' | 'REFUND' | 'PAYMENT';
      signal?: AbortSignal;
    } = {},
  ) {
    options.signal?.throwIfAborted();
    const snapshot = context.getSnapshot();
    const shipment = asObject(snapshot.artifacts.shipment?.value) ?? {};
    const order = asObject(snapshot.artifacts.order?.value) ?? {};
    const originalMode = transportMode(shipment.transportMode);
    await context.emit({
      type: 'connector.call.started',
      stepId: step.id,
      payload: {
        connectorState: connectorState('YUNO', 'running', 'MOCK_CONNECTOR') as unknown as JsonValue,
      },
      truth: 'MOCK_CONNECTOR',
    });
    const result = await quoteWithYunoMock({
      orderId: textValue(shipment.orderId, 'RS-DEMO'),
      productValueUsd: finiteNumber(order.productValueUsd, 72_000),
      originalMode,
      proposedMode: options.proposedMode ?? originalMode,
      distanceKm: finiteNumber(shipment.distanceKm, 9_250),
      promiseDays: finiteNumber(shipment.promiseDays, 30),
      operation: options.operation,
    });
    options.signal?.throwIfAborted();
    const state = connectorState(
      'YUNO',
      result.status,
      result.classification,
      result.data as unknown as JsonObject,
    );
    await context.emit({
      type: 'connector.call.completed',
      stepId: step.id,
      payload: { connectorState: state as unknown as JsonValue },
      truth: 'MOCK_CONNECTOR',
    });
    if (result.data) {
      const artifact = nowArtifact(
        context.getSnapshot(),
        'yunoQuote',
        'commercial-quote',
        result.data as unknown as JsonValue,
        'MOCK_CONNECTOR',
      );
      await context.emit({
        type: 'artifact.upserted',
        stepId: step.id,
        payload: { artifact: artifact as unknown as JsonValue },
        truth: 'MOCK_CONNECTOR',
      });
    }
    return result.data;
  }

  private async executeRoutePricing(
    context: RunExecutionContext,
    step: StepDefinition,
    options: {
      proposedMode?: 'AIR' | 'OCEAN' | 'OCEAN_ROAD' | 'RAIL_OCEAN';
      operation?: 'QUOTE' | 'REQUOTE';
      signal?: AbortSignal;
    } = {},
  ) {
    options.signal?.throwIfAborted();
    const snapshot = context.getSnapshot();
    const shipment = asObject(snapshot.artifacts.shipment?.value) ?? {};
    const order = asObject(snapshot.artifacts.order?.value) ?? {};
    const originalMode = transportMode(shipment.transportMode);
    const quote = calculateRouteQuote({
      orderId: textValue(shipment.orderId, 'RS-DEMO'),
      productValueUsd: finiteNumber(order.productValueUsd, 72_000),
      originalMode,
      proposedMode: options.proposedMode ?? originalMode,
      distanceKm: finiteNumber(shipment.distanceKm, 9_250),
      promiseDays: finiteNumber(shipment.promiseDays, 30),
      operation: options.operation,
    });
    options.signal?.throwIfAborted();
    const artifact = nowArtifact(
      context.getSnapshot(),
      'routeQuote',
      options.operation === 'REQUOTE' ? 'commercial-requote' : 'commercial-quote',
      quote as unknown as JsonValue,
      'SIMULATED_IF_TODAY',
      {
        classification: 'SIMULATED_IF_TODAY',
        sourceTitle: 'RouteShift transparent pricing model',
        confidence: 0.75,
      },
    );
    await context.emit({
      type: 'artifact.upserted',
      stepId: step.id,
      payload: { artifact: artifact as unknown as JsonValue },
      truth: 'SIMULATED_IF_TODAY',
    });

    const externalActions = asObject(snapshot.artifacts.externalActions?.value);
    if (options.operation !== 'REQUOTE' && externalActions?.yunoSandbox === true) {
      const configured = createYunoSandboxClientFromEnv();
      const startTruth: TruthClassification = configured.client
        ? 'EXTERNAL_SANDBOX'
        : 'UNKNOWN';
      await context.emit({
        type: 'connector.call.started',
        stepId: step.id,
        payload: {
          connectorState: connectorState(
            'YUNO_SANDBOX',
            'running',
            startTruth,
            { environment: 'sandbox', configured: Boolean(configured.client) },
          ) as unknown as JsonValue,
        },
        truth: startTruth,
      });

      if (!configured.client) {
        await context.emit({
          type: 'connector.call.completed',
          stepId: step.id,
          payload: {
            connectorState: connectorState(
              'YUNO_SANDBOX',
              'unavailable',
              'UNKNOWN',
              {
                environment: 'sandbox',
                configured: false,
                fallbackActive: true,
                publicNote:
                  'Yuno Sandbox was explicitly requested, but the server is not configured. No external payment link or payment state was created.',
              },
            ) as unknown as JsonValue,
          },
          truth: 'UNKNOWN',
        });
      } else {
        try {
          const paymentLink = await configured.client.createPaymentLink({
            idempotencyKey: crypto.randomUUID(),
            merchantOrderId: textValue(shipment.orderId, 'RS-DEMO'),
            description: `RouteShift delivery ${textValue(shipment.orderId, 'RS-DEMO')}`,
            country: 'US',
            amount: {
              value: Math.max(1, Math.round(quote.revisedTotal)),
              currency: quote.currency,
            },
            capture: false,
            oneTimeUse: true,
          });
          const safePaymentLink: JsonObject = {
            environment: paymentLink.environment,
            linkCode: paymentLink.data.linkCode,
            merchantOrderId:
              paymentLink.data.merchantOrderId ?? textValue(shipment.orderId, 'RS-DEMO'),
            status: paymentLink.data.status,
            amount: paymentLink.data.amount as unknown as JsonValue,
            capture: paymentLink.data.capture,
            oneTimeUse: paymentLink.data.oneTimeUse,
            sourceUrl: paymentLink.data.checkoutUrl,
            publicNote: paymentLink.publicNote,
          };
          await context.emit({
            type: 'connector.call.completed',
            stepId: step.id,
            payload: {
              connectorState: connectorState(
                'YUNO_SANDBOX',
                'available',
                'EXTERNAL_SANDBOX',
                safePaymentLink,
              ) as unknown as JsonValue,
            },
            truth: 'EXTERNAL_SANDBOX',
          });
          await context.emit({
            type: 'artifact.upserted',
            stepId: step.id,
            payload: {
              artifact: nowArtifact(
                context.getSnapshot(),
                'yunoPaymentLink',
                'payment-link',
                safePaymentLink,
                'EXTERNAL_SANDBOX',
                {
                  classification: 'EXTERNAL_SANDBOX',
                  sourceTitle: 'Yuno Sandbox hosted checkout',
                  sourceUrl: paymentLink.data.checkoutUrl,
                  retrievedAt: paymentLink.fetchedAt,
                  confidence: 1,
                },
              ) as unknown as JsonValue,
            },
            truth: 'EXTERNAL_SANDBOX',
          });
        } catch {
          await context.emit({
            type: 'connector.call.completed',
            stepId: step.id,
            payload: {
              connectorState: connectorState(
                'YUNO_SANDBOX',
                'failed',
                'UNKNOWN',
                {
                  environment: 'sandbox',
                  configured: true,
                  fallbackActive: true,
                  publicNote:
                    'Yuno Sandbox did not return a validated payment link. No provider error detail or credential was exposed.',
                },
              ) as unknown as JsonValue,
            },
            truth: 'UNKNOWN',
          });
        }
      }
    }
    return quote;
  }

  private async executeNauta(
    context: RunExecutionContext,
    step: StepDefinition,
    options: {
      operation?: 'TRACK' | 'REROUTE' | 'RELEASE' | 'MILESTONES';
      route?: string[];
      disruption?: 'NONE' | 'TRANSSHIPMENT' | 'ROUTE_INTERRUPTION' | 'VISIBILITY_DEGRADED';
      signal?: AbortSignal;
    } = {},
  ) {
    options.signal?.throwIfAborted();
    const snapshot = context.getSnapshot();
    const shipment = asObject(snapshot.artifacts.shipment?.value) ?? {};
    await context.emit({
      type: 'connector.call.started',
      stepId: step.id,
      payload: {
        connectorState: connectorState('NAUTA', 'running', 'MOCK_CONNECTOR') as unknown as JsonValue,
      },
      truth: 'MOCK_CONNECTOR',
    });
    const result = await trackWithNautaMock({
      orderId: textValue(shipment.orderId, 'RS-DEMO'),
      containerNumber: textValue(
        asObject(snapshot.artifacts.booking?.value)?.containerNumber,
        'MSCU0142026',
      ),
      origin: textValue(shipment.origin, 'Shanghai'),
      destination: textValue(shipment.destination, 'Gaziantep'),
      route:
        options.route ??
        (Array.isArray(shipment.route)
          ? shipment.route.filter((item): item is string => typeof item === 'string')
          : ['Shanghai', 'Gaziantep']),
      disruption: options.disruption ?? disruption(shipment.disruption),
      operation: options.operation,
    });
    options.signal?.throwIfAborted();
    const state = connectorState(
      'NAUTA',
      result.status,
      result.classification,
      result.data as unknown as JsonObject,
    );
    await context.emit({
      type: 'connector.call.completed',
      stepId: step.id,
      payload: { connectorState: state as unknown as JsonValue },
      truth: 'MOCK_CONNECTOR',
    });
    if (result.data) {
      const artifact = nowArtifact(
        context.getSnapshot(),
        'nautaTracking',
        'shipment-visibility',
        result.data as unknown as JsonValue,
        'MOCK_CONNECTOR',
      );
      await context.emit({
        type: 'artifact.upserted',
        stepId: step.id,
        payload: { artifact: artifact as unknown as JsonValue },
        truth: 'MOCK_CONNECTOR',
      });
    }
    return result.data;
  }

  private async executeCurrentContext(
    context: RunExecutionContext,
    step: StepDefinition,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    await context.emit({
      type: 'connector.call.started',
      stepId: step.id,
      payload: {
        connectorState: connectorState(
          'NASA_EONET',
          'running',
          'LIVE_CURRENT_CONTEXT',
        ) as unknown as JsonValue,
      },
      truth: 'LIVE_CURRENT_CONTEXT',
    });

    // Current context can enrich the incident, but it never blocks the
    // deterministic demo path. The connector aborts quickly and returns an
    // explicit UNKNOWN/unavailable envelope when NASA cannot be reached.
    const result = await fetchCurrentEonetContext({ timeoutMs: 2_500, signal });
    signal?.throwIfAborted();
    const events = (result.data ?? []).slice(0, 12).map((event) => ({
      eventId: event.eventId,
      title: event.title,
      category: event.category,
      observedAt: event.observedAt,
      coordinates: event.coordinates,
    }));
    const contextData: JsonObject = {
      status: result.status,
      fetchedAt: result.fetchedAt,
      expiresAt: result.expiresAt ?? null,
      eventCount: events.length,
      events,
      publicNote: result.publicNote,
    };
    await context.emit({
      type: 'connector.call.completed',
      stepId: step.id,
      payload: {
        connectorState: connectorState(
          'NASA_EONET',
          result.status,
          result.classification,
          contextData,
        ) as unknown as JsonValue,
      },
      truth: result.classification,
    });
    const artifact = nowArtifact(
      context.getSnapshot(),
      'currentContext',
      'current-context',
      contextData,
      result.classification,
      {
        classification: result.classification,
        sourceTitle: 'NASA EONET open events',
        sourceUrl: 'https://eonet.gsfc.nasa.gov/',
        retrievedAt: result.fetchedAt,
        confidence: result.status === 'available' ? 0.95 : result.status === 'stale' ? 0.6 : 0,
      },
    );
    await context.emit({
      type: 'artifact.upserted',
      stepId: step.id,
      payload: { artifact: artifact as unknown as JsonValue },
      truth: result.classification,
    });
    const finding: RuntimeFinding = {
      id: 'nasa-eonet-current-context',
      kind: 'current-context',
      severity: result.status === 'unavailable' ? 'warning' : 'info',
      title:
        result.status === 'available'
          ? 'NASA current context available'
          : result.status === 'stale'
            ? 'NASA current context is stale'
            : 'NASA current context unavailable',
      summary: result.publicNote,
      confidence: artifact.provenance?.confidence,
      details: {
        status: result.status,
        fetchedAt: result.fetchedAt,
        eventCount: events.length,
      },
      truth: result.classification,
    };
    await context.emit({
      type: 'finding.recorded',
      stepId: step.id,
      payload: { finding: finding as unknown as JsonValue },
      truth: result.classification,
    });
    return contextData;
  }

  private async executeTransportContext(
    context: RunExecutionContext,
    step: StepDefinition,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const shipment = asObject(context.getSnapshot().artifacts.shipment?.value) ?? {};
    const mode = transportMode(shipment.transportMode);
    const isAir = mode === 'AIR';
    const connectorId = isAir ? 'ADSB_LOL' : 'AISSTREAM';
    await context.emit({
      type: 'connector.call.started',
      stepId: step.id,
      payload: {
        connectorState: connectorState(
          connectorId,
          'running',
          'LIVE_CURRENT_CONTEXT',
          { association: 'CORRIDOR_TRAFFIC_ONLY' },
        ) as unknown as JsonValue,
      },
      truth: 'LIVE_CURRENT_CONTEXT',
    });

    const destination = textValue(shipment.destination, 'Gaziantep');
    const coordinates = coordinatePair(shipment.destinationCoordinates);
    const result = isAir
      ? await fetchAdsbLolAircraft(
          {
            latitude: coordinates?.[1] ?? 37.0662,
            longitude: coordinates?.[0] ?? 37.3781,
            radiusNm: 35,
          },
          { timeoutMs: 2_500, signal },
        )
      : await collectAISStream(
          {
            boundingBox: maritimeBoundingBox(destination),
            messageTypes: ['PositionReport', 'ShipStaticData'],
            maxMessages: 12,
          },
          { timeoutMs: 2_500, signal },
        );
    signal?.throwIfAborted();

    const observations = result.data
      ? isAir
        ? 'aircraft' in result.data
          ? result.data.aircraft.slice(0, 12)
          : []
        : 'observations' in result.data
          ? result.data.observations.slice(0, 12)
          : []
      : [];
    const contextData: JsonObject = {
      provider: connectorId,
      mode,
      status: result.status,
      fetchedAt: result.fetchedAt,
      expiresAt: result.expiresAt ?? null,
      association: 'CORRIDOR_TRAFFIC_ONLY',
      observationCount: observations.length,
      observations: observations as unknown as JsonValue,
      sourceUrl: isAir ? 'https://api.adsb.lol/' : 'https://aisstream.io/',
      publicNote: result.publicNote,
    };
    await context.emit({
      type: 'connector.call.completed',
      stepId: step.id,
      payload: {
        connectorState: connectorState(
          connectorId,
          result.status,
          result.classification,
          contextData,
        ) as unknown as JsonValue,
      },
      truth: result.classification,
    });
    await context.emit({
      type: 'artifact.upserted',
      stepId: step.id,
      payload: {
        artifact: nowArtifact(
          context.getSnapshot(),
          'liveTransportContext',
          'live-transport-context',
          contextData,
          result.classification,
          {
            classification: result.classification,
            sourceTitle: isAir ? 'ADSB.lol live aircraft data' : 'AISStream live vessel data',
            sourceUrl: isAir ? 'https://api.adsb.lol/' : 'https://aisstream.io/',
            retrievedAt: result.fetchedAt,
            confidence: result.status === 'available' ? 0.95 : 0,
          },
        ) as unknown as JsonValue,
      },
      truth: result.classification,
    });
    const finding: RuntimeFinding = {
      id: `live-transport-${connectorId.toLowerCase()}`,
      kind: 'live-transport-context',
      severity: result.status === 'unavailable' ? 'warning' : 'info',
      title: result.status === 'available'
        ? `${connectorId} current traffic available`
        : `${connectorId} current traffic unavailable`,
      summary: result.publicNote,
      confidence: result.status === 'available' ? 0.95 : 0,
      details: {
        association: 'CORRIDOR_TRAFFIC_ONLY',
        observationCount: observations.length,
        fetchedAt: result.fetchedAt,
      },
      truth: result.classification,
    };
    await context.emit({
      type: 'finding.recorded',
      stepId: step.id,
      payload: { finding: finding as unknown as JsonValue },
      truth: result.classification,
    });
    return contextData;
  }

  private async correctDocument(
    context: RunExecutionContext,
    step: StepDefinition,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const snapshot = context.getSnapshot();
    const booking = asObject(snapshot.artifacts.booking?.value) ?? {};
    const currentBill = asObject(snapshot.artifacts.billOfLading?.value) ?? {};
    const corrected: JsonObject = {
      ...currentBill,
      bookingNumber: booking.bookingNumber ?? currentBill.bookingNumber ?? null,
      containerNumber: booking.containerNumber ?? currentBill.containerNumber ?? null,
      portOfLoading: booking.portOfLoading ?? currentBill.portOfLoading ?? null,
      portOfDischarge: booking.portOfDischarge ?? currentBill.portOfDischarge ?? null,
      grossWeightKg: booking.grossWeightKg ?? currentBill.grossWeightKg ?? null,
      packageCount: booking.packageCount ?? currentBill.packageCount ?? null,
      correctedBy: 'MOCK_CONNECTOR',
    };
    await context.emit({
      type: 'connector.call.started',
      stepId: step.id,
      payload: {
        connectorState: connectorState(
          'DOCUMENT_CORRECTION',
          'running',
          'MOCK_CONNECTOR',
        ) as unknown as JsonValue,
      },
      truth: 'MOCK_CONNECTOR',
    });
    signal?.throwIfAborted();
    await context.emit({
      type: 'connector.call.completed',
      stepId: step.id,
      payload: {
        connectorState: connectorState(
          'DOCUMENT_CORRECTION',
          'available',
          'MOCK_CONNECTOR',
          { status: 'CORRECTED' },
        ) as unknown as JsonValue,
      },
      truth: 'MOCK_CONNECTOR',
    });
    await context.emit({
      type: 'artifact.upserted',
      stepId: step.id,
      payload: {
        artifact: nowArtifact(
          context.getSnapshot(),
          'billOfLading',
          'bill-of-lading',
          corrected,
          'MOCK_CONNECTOR',
        ) as unknown as JsonValue,
      },
      truth: 'MOCK_CONNECTOR',
    });
    return corrected;
  }

  private async extractOrder(
    context: RunExecutionContext,
    step: StepDefinition,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const snapshot = context.getSnapshot();
    const shipment = asObject(snapshot.artifacts.shipment?.value) ?? {};
    const order = asObject(snapshot.artifacts.order?.value) ?? {};
    const extraction: JsonObject = {
      orderId: shipment.orderId ?? null,
      customer: order.customer ?? null,
      product: order.product ?? null,
      origin: shipment.origin ?? null,
      destination: shipment.destination ?? null,
      transportMode: shipment.transportMode ?? null,
      promiseDays: shipment.promiseDays ?? null,
    };
    const summary = await this.agent.summarize({
      objective: 'The order was extracted into bounded operational fields.',
      evidence: [
        `Origin: ${textValue(shipment.origin, 'unknown')}`,
        `Destination: ${textValue(shipment.destination, 'unknown')}`,
        `Mode: ${transportMode(shipment.transportMode)}`,
      ],
      confidence: 0.99,
      selectedAction: 'prepare-booking',
    });
    signal?.throwIfAborted();
    await context.emit({
      type: 'artifact.upserted',
      stepId: step.id,
      payload: {
        artifact: nowArtifact(
          context.getSnapshot(),
          'agentExtraction',
          'agent-extraction',
          extraction,
          'SIMULATED_IF_TODAY',
        ) as unknown as JsonValue,
      },
      truth: 'SIMULATED_IF_TODAY',
    });
    await context.emit({
      type: 'agent.summary.updated',
      stepId: step.id,
      payload: { summary: summary as unknown as JsonValue },
      truth: 'SIMULATED_IF_TODAY',
    });
    return extraction;
  }

  private async classifyStep(
    context: RunExecutionContext,
    step: StepDefinition,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const classification: JsonObject = {
      kind: step.kind,
      owner: step.owner,
      capabilities: step.capabilities,
      priority: step.presentation?.priority ?? 'normal',
      safeGenericFallback: true,
    };
    await context.emit({
      type: 'artifact.upserted',
      stepId: step.id,
      payload: {
        artifact: nowArtifact(
          context.getSnapshot(),
          'agentClassification',
          'agent-classification',
          classification,
          'SIMULATED_IF_TODAY',
        ) as unknown as JsonValue,
      },
      truth: 'SIMULATED_IF_TODAY',
    });
    return classification;
  }

  private rerouteFor(snapshot: RunSnapshot) {
    const shipment = asObject(snapshot.artifacts.shipment?.value) ?? {};
    return [
      textValue(shipment.origin, 'Shanghai'),
      'Dubai air gateway',
      textValue(shipment.destination, 'Gaziantep'),
    ];
  }

  private async dispatchTool(
    context: RunExecutionContext,
    step: StepDefinition,
    toolId: ToolId,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    const proposedMode = transportMode(step.tool?.parameters?.proposedMode);
    switch (toolId) {
      case 'mock.document.compare':
        return this.compareDocuments(context, step, signal) as unknown as JsonValue;
      case 'mock.document.correct':
        return this.correctDocument(context, step, signal);
      case 'mock.yuno.quote':
        return (await this.executeYuno(context, step, {
          operation: 'QUOTE',
          signal,
        })) as unknown as JsonValue;
      case 'mock.yuno.requote':
        return (await this.executeYuno(context, step, {
          operation: 'REQUOTE',
          proposedMode,
          signal,
        })) as unknown as JsonValue;
      case 'mock.yuno.refund':
        return (await this.executeYuno(context, step, {
          operation: 'REFUND',
          proposedMode,
          signal,
        })) as unknown as JsonValue;
      case 'mock.yuno.payment':
        return (await this.executeYuno(context, step, {
          operation: 'PAYMENT',
          proposedMode,
          signal,
        })) as unknown as JsonValue;
      case 'route.pricing.quote':
        return (await this.executeRoutePricing(context, step, {
          operation: 'QUOTE',
          signal,
        })) as unknown as JsonValue;
      case 'route.pricing.requote':
        return (await this.executeRoutePricing(context, step, {
          operation: 'REQUOTE',
          proposedMode,
          signal,
        })) as unknown as JsonValue;
      case 'yuno.sandbox.payment-link':
      case 'yuno.sandbox.cancel-or-refund':
        throw new Error('Yuno Sandbox dispatch is not configured for this run.');
      case 'mock.nauta.track':
        return (await this.executeNauta(context, step, { operation: 'TRACK', signal })) as unknown as JsonValue;
      case 'mock.nauta.reroute':
        return (await this.executeNauta(context, step, {
          operation: 'REROUTE',
          route: this.rerouteFor(context.getSnapshot()),
          disruption: 'NONE',
          signal,
        })) as unknown as JsonValue;
      case 'mock.nauta.milestones':
        return (await this.executeNauta(context, step, {
          operation: 'MILESTONES',
          signal,
        })) as unknown as JsonValue;
      case 'nasa.eonet.current-context':
        return this.executeCurrentContext(context, step, signal);
      case 'transport.live-context':
        return this.executeTransportContext(context, step, signal);
      case 'agent.extract':
        return this.extractOrder(context, step, signal);
      case 'agent.classify':
        return this.classifyStep(context, step, signal);
      default: {
        const unsupported: never = toolId;
        throw new Error(`Unsupported runtime tool: ${String(unsupported)}`);
      }
    }
  }

  private async executeToolWithPolicy(
    context: RunExecutionContext,
    step: StepDefinition,
    toolId: ToolId,
    execute: (signal: AbortSignal) => Promise<JsonValue> = (signal) =>
      this.dispatchTool(context, step, toolId, signal),
  ) {
    const timeoutMs = step.timeoutMs ?? 10_000;
    const maxAttempts = step.retry?.maxAttempts ?? 1;
    let finalError: unknown = new Error('Tool execution failed.');

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await context.emit({
        type: 'tool.call.started',
        stepId: step.id,
        payload: { toolId, attempt, maxAttempts, timeoutMs },
        truth: toolTruth(toolId),
      });
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new StepExecutionTimeoutError(step.id, timeoutMs));
          }, timeoutMs);
        });
        const result = await Promise.race([execute(controller.signal), deadline]);
        if (timer) clearTimeout(timer);
        await context.emit({
          type: 'tool.call.completed',
          stepId: step.id,
          payload: { toolId, attempt, result },
          truth: toolTruth(toolId),
        });
        return result;
      } catch (error) {
        if (timer) clearTimeout(timer);
        controller.abort();
        finalError = error;
        await context.emit({
          type: 'tool.call.failed',
          stepId: step.id,
          payload: {
            toolId,
            attempt,
            errorCode: publicErrorCode(error),
            retrying: attempt < maxAttempts,
          },
          truth: toolTruth(toolId),
        });
        if (attempt < maxAttempts) {
          await wait(Math.min(30_000, (step.retry?.backoffMs ?? 0) * attempt));
        }
      }
    }
    throw finalError;
  }

  private async failStep(
    context: RunExecutionContext,
    step: StepDefinition,
    error: unknown,
  ) {
    await context.emit({
      type: 'step.failed',
      stepId: step.id,
      payload: { stepId: step.id, errorCode: publicErrorCode(error) },
      truth: 'UNKNOWN',
    });
    await context.emit({
      type: 'run.failed',
      stepId: step.id,
      payload: { stepId: step.id, errorCode: publicErrorCode(error) },
      truth: 'UNKNOWN',
    });
  }

  private async emitHumanActionConsequences(
    context: RunExecutionContext,
    step: StepDefinition,
    actionId: string,
  ) {
    if (actionId !== 'reroute' && actionId !== 'release') return;
    const snapshot = context.getSnapshot();
    const shipment = asObject(snapshot.artifacts.shipment?.value) ?? {};
    const route = actionId === 'reroute'
      ? this.rerouteFor(snapshot)
      : Array.isArray(shipment.route)
        ? shipment.route.filter((item): item is string => typeof item === 'string')
        : [textValue(shipment.origin, 'Shanghai'), textValue(shipment.destination, 'Gaziantep')];

    await this.executeToolWithPolicy(
      context,
      step,
      actionId === 'reroute' ? 'mock.nauta.reroute' : 'mock.nauta.track',
      (signal) => this.executeNauta(context, step, {
        operation: actionId === 'reroute' ? 'REROUTE' : 'RELEASE',
        disruption: 'NONE',
        route,
        signal,
      }) as Promise<JsonValue>,
    );
    await this.executeToolWithPolicy(
      context,
      step,
      actionId === 'reroute' ? 'route.pricing.requote' : 'mock.yuno.payment',
      (signal) => actionId === 'reroute'
        ? this.executeRoutePricing(context, step, {
            operation: 'REQUOTE',
            proposedMode: 'AIR',
            signal,
          }) as Promise<JsonValue>
        : this.executeYuno(context, step, {
            operation: 'PAYMENT',
            proposedMode: transportMode(shipment.transportMode),
            signal,
          }) as Promise<JsonValue>,
    );

    const updatedShipment: JsonObject = {
      ...shipment,
      route,
      disruption: 'NONE',
      state: actionId === 'reroute' ? 'rerouted' : 'released',
      transportMode: actionId === 'reroute' ? 'AIR' : transportMode(shipment.transportMode),
      etaRevisionDays: actionId === 'reroute' ? 4 : 0,
    };
    await context.emit({
      type: 'artifact.upserted',
      stepId: step.id,
      payload: {
        artifact: nowArtifact(
          context.getSnapshot(),
          'shipment',
          'shipment',
          updatedShipment,
          'MOCK_CONNECTOR',
        ) as unknown as JsonValue,
      },
      truth: 'MOCK_CONNECTOR',
    });
    const summary: PublicAgentSummary = {
      summary:
        actionId === 'reroute'
          ? 'The approved reroute was simulated through the Nauta pattern and repriced by the transparent RouteShift model.'
          : 'The hold was released in Nauta and the Yuno mock confirmed the commercial state.',
      evidence: [
        `Nauta mock operation: ${actionId === 'reroute' ? 'REROUTED' : 'RELEASED'}`,
        actionId === 'reroute'
          ? 'RouteShift simulated pricing operation: REQUOTE'
          : 'Yuno mock operation: PAYMENT',
      ],
      selectedAction: actionId,
      confidence: 0.99,
      providerId: 'route-shift-runtime-v1',
      providerMode: 'deterministic_fallback',
    };
    await context.emit({
      type: 'agent.summary.updated',
      stepId: step.id,
      payload: { summary: summary as unknown as JsonValue },
      truth: 'MOCK_CONNECTOR',
    });
  }

  private async materializePreparedDocuments(
    context: RunExecutionContext,
    step: StepDefinition,
  ) {
    if (
      !step.capabilities.includes('booking.view') ||
      !step.capabilities.includes('document.view')
    ) {
      return;
    }
    const draft = asObject(
      context.getSnapshot().artifacts.bookingPreparationInputs?.value,
    );
    if (!draft) return;

    const documents: Array<{
      id: 'booking' | 'billOfLading';
      kind: 'booking' | 'bill-of-lading';
    }> = [
      { id: 'booking', kind: 'booking' },
      { id: 'billOfLading', kind: 'bill-of-lading' },
    ];
    for (const document of documents) {
      const value = asObject(draft[document.id]);
      if (!value) continue;
      await context.emit({
        type: 'artifact.upserted',
        stepId: step.id,
        payload: {
          artifact: nowArtifact(
            context.getSnapshot(),
            document.id,
            document.kind,
            value,
            'SIMULATED_IF_TODAY',
          ) as unknown as JsonValue,
        },
        truth: 'SIMULATED_IF_TODAY',
      });
    }
    await context.emit({
      type: 'artifact.invalidated',
      stepId: step.id,
      payload: {
        artifactId: 'bookingPreparationInputs',
        reason: 'materialized-by-document-preparation-step',
      },
      truth: 'SIMULATED_IF_TODAY',
    });
  }

  private async executeStep(
    context: RunExecutionContext,
    step: StepDefinition,
  ): Promise<{ paused: boolean; next: string | null | undefined }> {
    let completedOutcome = 'success';
    await context.emit({
      type: 'step.started',
      stepId: step.id,
      payload: { stepId: step.id, title: step.title },
      truth: 'SIMULATED_IF_TODAY',
    });

    if (!evaluateStepCondition(context.getSnapshot(), step.when)) {
      await context.emit({
        type: 'step.skipped',
        stepId: step.id,
        payload: { stepId: step.id, reason: 'condition-not-met' },
        truth: 'SIMULATED_IF_TODAY',
      });
      await this.emitUI(context);
      return { paused: false, next: nextStep(context.getFlow(), step, 'skipped') ?? nextStep(context.getFlow(), step, 'success') };
    }

    await this.materializePreparedDocuments(context, step);

    try {
      const toolId =
        step.tool?.id ??
        (step.capabilities.includes('document.compare')
          ? 'mock.document.compare'
          : undefined);
      if (toolId) {
        const result = await this.executeToolWithPolicy(context, step, toolId);
        if (toolId === 'mock.document.compare') {
          const comparison = result as unknown as DocumentComparison;
          if (!comparison.matches) {
            await this.requestDecision(context, step, comparison.publicSummary);
            return { paused: true, next: undefined };
          }
          completedOutcome = 'match';
        }
      }

      if (
        step.capabilities.includes('incident.explain') &&
        step.tool?.id !== 'nasa.eonet.current-context'
      ) {
        await this.executeToolWithPolicy(
          context,
          step,
          'nasa.eonet.current-context',
        );
      }
      if (
        step.capabilities.includes('container.track') &&
        step.tool?.id !== 'transport.live-context'
      ) {
        await this.executeToolWithPolicy(
          context,
          step,
          'transport.live-context',
        );
      }
    } catch (error) {
      await this.failStep(context, step, error);
      return { paused: true, next: undefined };
    }

    if (
      !step.capabilities.includes('document.compare') &&
      (step.owner === 'human' || step.capabilities.includes('decision.request'))
    ) {
      await this.requestDecision(
        context,
        step,
        'A material operational consequence requires an explicit human choice before the run can continue.',
      );
      return { paused: true, next: undefined };
    }

    // Emit progressively while the step is active. Run completion emits one
    // final specification from the materialized completed snapshot.
    await this.emitUI(context);
    await context.emit({
      type: 'step.completed',
      stepId: step.id,
      payload: { stepId: step.id, outcome: completedOutcome },
      truth: 'SIMULATED_IF_TODAY',
    });
    return {
      paused: false,
      next:
        nextStep(context.getFlow(), step, completedOutcome) ??
        nextStep(context.getFlow(), step, 'success'),
    };
  }

  async advance(context: RunExecutionContext, startStepId?: string): Promise<void> {
    let stepId: string | null =
      startStepId ?? context.getSnapshot().currentStepId ?? context.getFlow().entryStepId;
    const visited = new Map<string, number>();

    for (let index = 0; stepId && index < MAX_AUTOMATIC_STEPS; index += 1) {
      const visits = (visited.get(stepId) ?? 0) + 1;
      visited.set(stepId, visits);
      if (visits > 4) throw new Error(`Flow cycle limit exceeded at step ${stepId}`);

      const step = context.getFlow().steps.find((candidate) => candidate.id === stepId);
      if (!step) throw new Error(`Unknown runtime step ${stepId}`);
      const result = await this.executeStep(context, step);
      if (result.paused) return;
      if (result.next === undefined) {
        throw new Error(`Step ${step.id} did not define a transition for its outcome`);
      }
      stepId = result.next;
    }

    if (stepId) throw new Error('Automatic flow execution exceeded its bounded step limit.');
    await this.complete(context);
  }

  async resume(context: RunExecutionContext, action: HumanAction): Promise<void> {
    const snapshot = context.getSnapshot();
    const stepId = snapshot.currentStepId;
    const step = context.getFlow().steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error('The paused runtime step no longer exists.');

    await context.emit({
      type: 'human.action.received',
      stepId: step.id,
      payload: {
        actionId: action.actionId,
        decisionId: action.decisionId,
        idempotencyKey: action.idempotencyKey,
      },
      truth: 'SIMULATED_IF_TODAY',
    });

    if (step.capabilities.includes('document.compare')) {
      if (action.actionId === 'request-corrected-document') {
        try {
          await this.executeToolWithPolicy(
            context,
            step,
            'mock.document.correct',
          );
        } catch (error) {
          await this.failStep(context, step, error);
          return;
        }
      }

      await context.emit({
        type: 'run.resumed',
        stepId: step.id,
        payload: { resumed: true },
        truth: 'SIMULATED_IF_TODAY',
      });

      if (action.actionId === 'approve-exception') {
        await this.emitUI(context);
        await context.emit({
          type: 'step.completed',
          stepId: step.id,
          payload: { stepId: step.id, outcome: 'approve-exception' },
          truth: 'SIMULATED_IF_TODAY',
        });
        const next =
          nextStep(context.getFlow(), step, 'approve-exception') ??
          nextStep(context.getFlow(), step, 'success') ??
          nextStep(context.getFlow(), step, 'match');
        if (next === undefined) throw new Error(`Step ${step.id} has no continuation.`);
        if (next === null) return this.complete(context);
        return this.advance(context, next);
      }

      return this.advance(context, step.id);
    }

    if (action.actionId === 'hold' || action.actionId === 'escalate') {
      await context.emit({
        type: 'run.resumed',
        stepId: step.id,
        payload: { resumed: true },
        truth: 'SIMULATED_IF_TODAY',
      });
      const expectedRevision = context.getSnapshot().revision + 3;
      const decision: PendingDecision = {
        decisionId: `decision-${crypto.randomUUID()}`,
        title: action.actionId === 'hold' ? 'Shipment remains on hold' : 'Escalation requires resolution',
        explanation:
          'Fulfillment remains blocked until a release, reroute or explicit exception is recorded.',
        actions: [
          { actionId: 'release', label: 'Release shipment', intent: 'release', requiresConfirmation: true },
          { actionId: 'reroute', label: 'Approve reroute', intent: 'reroute', requiresConfirmation: true },
          { actionId: 'escalate', label: 'Escalate again', intent: 'escalate', requiresConfirmation: true },
        ],
        expectedRevision,
        requestedAt: new Date().toISOString(),
      };
      await context.emit({
        type: 'decision.requested',
        stepId: step.id,
        payload: { decision: decision as unknown as JsonValue },
        truth: 'SIMULATED_IF_TODAY',
      });
      await context.emit({
        type: 'run.awaiting_human',
        stepId: step.id,
        payload: { decisionId: decision.decisionId },
        truth: 'SIMULATED_IF_TODAY',
      });
      await this.emitUI(context);
      return;
    }

    try {
      await this.emitHumanActionConsequences(context, step, action.actionId);
    } catch (error) {
      await this.failStep(context, step, error);
      return;
    }

    await context.emit({
      type: 'run.resumed',
      stepId: step.id,
      payload: { resumed: true },
      truth: 'SIMULATED_IF_TODAY',
    });
    await this.emitUI(context);
    await context.emit({
      type: 'step.completed',
      stepId: step.id,
      payload: { stepId: step.id, outcome: action.actionId },
      truth: 'SIMULATED_IF_TODAY',
    });
    const next = nextStep(context.getFlow(), step, action.actionId) ?? nextStep(context.getFlow(), step, 'success');
    if (next === undefined) throw new Error(`Step ${step.id} has no continuation for ${action.actionId}.`);
    if (next === null) return this.complete(context);
    await this.advance(context, next);
  }
}
