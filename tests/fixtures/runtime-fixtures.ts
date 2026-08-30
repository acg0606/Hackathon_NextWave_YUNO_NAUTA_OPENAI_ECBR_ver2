import type {
  FlowDefinition,
  RunEvent,
  RunSnapshot,
  StepDefinition,
} from '@/lib/runtime/contracts';

export const fixedNow = '2026-08-30T12:00:00.000Z';

export function makeStep(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    schemaVersion: '1.0',
    id: 'prepare-booking',
    title: 'Prepare booking',
    description: 'Prepare the booking artifacts.',
    kind: 'extract',
    capabilities: ['booking.view'],
    owner: 'agent',
    ...overrides,
  };
}

export function makeFlow(step = makeStep()): FlowDefinition {
  return {
    schemaVersion: '1.0',
    id: 'test-flow',
    version: 1,
    name: 'Test flow',
    description: 'A deterministic runtime test flow.',
    entryStepId: step.id,
    steps: [step],
    transitions: [{ fromStepId: step.id, outcome: 'success', toStepId: null }],
    metadata: { persistence: 'IN_MEMORY_NON_DURABLE' },
  };
}

export function makeSnapshot(
  step = makeStep(),
  overrides: Partial<RunSnapshot> = {},
): RunSnapshot {
  return {
    runId: 'run-test-001',
    flowId: 'test-flow',
    flowVersion: 1,
    revision: 4,
    lastSequence: 4,
    status: 'running',
    currentStepId: step.id,
    completedStepIds: [],
    skippedStepIds: [],
    pendingDecision: null,
    artifacts: {},
    findings: [],
    connectorStates: {},
    publicAgentSummary: null,
    timestamps: { createdAt: fixedNow, updatedAt: fixedNow },
    latestUISpec: null,
    processedEventIds: ['event-1', 'event-2', 'event-3', 'event-4'],
    processedIdempotencyKeys: [],
    ...overrides,
  };
}

export function makeEvent(
  sequence: number,
  type: RunEvent['type'],
  payload: RunEvent['payload'] = {},
  overrides: Partial<RunEvent> = {},
): RunEvent {
  return {
    eventId: `event-${sequence}`,
    runId: 'run-test-001',
    sequence,
    revision: sequence,
    timestamp: fixedNow,
    type,
    payload,
    truth: 'SIMULATED_IF_TODAY',
    ...overrides,
  };
}

