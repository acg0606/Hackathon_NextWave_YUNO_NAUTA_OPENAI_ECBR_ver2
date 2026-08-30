import type {
  FlowDefinition,
  JsonObject,
  JsonValue,
  PublicAgentSummary,
  RunSnapshot,
  StepDefinition,
  StepKind,
  StepOwner,
} from './contracts';

export type JourneyStepStatus =
  | 'complete'
  | 'current'
  | 'waiting'
  | 'skipped'
  | 'queued';

export type TrajectoryShiftKind = 'disruption' | 'reroute' | 'requote';

export type DispatchJourneyStep = {
  stepId: string;
  title: string;
  description: string;
  owner: StepOwner;
  kind: StepKind;
  status: JourneyStepStatus;
  agentHighlighted: boolean;
};

export type DispatchTrajectoryShift = {
  kind: TrajectoryShiftKind;
  from: string[];
  to: string[];
  agentLabel: string;
  summary: string;
  highlightedStepId: string | null;
};

export type DispatchJourney = {
  steps: DispatchJourneyStep[];
  currentIndex: number;
  progressPercent: number;
  trajectoryShift: DispatchTrajectoryShift | null;
};

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  if (
    value === null ||
    value === undefined ||
    Array.isArray(value) ||
    typeof value !== 'object'
  ) {
    return undefined;
  }
  return value;
}

function textValue(value: JsonValue | undefined, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const object = asObject(item);
      return textValue(
        object?.label ?? object?.name ?? object?.location ?? object?.code,
      );
    })
    .filter(Boolean);
}

function inferredSteps(snapshot: RunSnapshot): StepDefinition[] {
  const ids = Array.from(
    new Set([
      ...snapshot.completedStepIds,
      ...snapshot.skippedStepIds,
      ...(snapshot.currentStepId ? [snapshot.currentStepId] : []),
    ]),
  );
  return ids.map((id) => ({
    schemaVersion: '1.0',
    id,
    title: id
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: 'Runtime-discovered step',
    kind: 'generic',
    capabilities: [],
    owner: 'system',
  }));
}

export function journeyStepStatus(
  step: StepDefinition,
  snapshot: RunSnapshot,
): JourneyStepStatus {
  if (snapshot.currentStepId === step.id) {
    return snapshot.status === 'awaiting_human' ? 'waiting' : 'current';
  }
  if (snapshot.skippedStepIds.includes(step.id)) return 'skipped';
  if (snapshot.completedStepIds.includes(step.id)) return 'complete';
  return 'queued';
}

export function ownerLabel(owner: StepOwner): string {
  switch (owner) {
    case 'agent':
      return 'Agent';
    case 'human':
      return 'Human';
    case 'system':
      return 'System';
    default: {
      const _exhaustive: never = owner;
      return _exhaustive;
    }
  }
}

export function journeyStatusLabel(status: JourneyStepStatus): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'current':
      return 'In progress';
    case 'waiting':
      return 'Human decision';
    case 'skipped':
      return 'Skipped';
    case 'queued':
      return 'Queued';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function trajectoryShiftTitle(kind: TrajectoryShiftKind): string {
  switch (kind) {
    case 'reroute':
      return 'Agent changed the dispatch trajectory';
    case 'requote':
      return 'Agent requoted the corridor';
    case 'disruption':
      return 'Agent detected a dispatch change';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function agentLabel(summary: PublicAgentSummary | null): string {
  if (!summary) return 'Ari';
  if (summary.providerMode === 'live') {
    return summary.model
      ? `Ari · ${summary.model}`
      : 'Ari · OpenAI structured agent';
  }
  if (summary.providerId && summary.providerId !== 'unknown') {
    return `Ari · ${summary.providerId.replaceAll('-', ' ')}`;
  }
  return 'Ari · deterministic fallback';
}

function disruptionPresent(shipment: JsonObject | undefined): boolean {
  const disruption = textValue(shipment?.disruption).toUpperCase();
  return disruption !== '' && disruption !== 'NONE' && disruption !== 'NO_DISRUPTION';
}

function shipmentState(shipment: JsonObject | undefined): string {
  return textValue(shipment?.state).toLowerCase();
}

function routesFromSnapshot(snapshot: RunSnapshot): {
  from: string[];
  to: string[];
} {
  const shipment = asObject(snapshot.artifacts.shipment?.value);
  const simulated = asObject(snapshot.artifacts.simulatedResponse?.value);
  const origin = textValue(shipment?.origin);
  const destination = textValue(shipment?.destination);
  const current = stringList(shipment?.route);
  const simulatedRoute = stringList(simulated?.route);
  const planned = stringList(shipment?.plannedRoute);
  const plannedFallback = stringList(shipment?.routeBefore);
  const corridor = [origin, destination].filter(Boolean);
  const to = current.length > 0
    ? current
    : simulatedRoute.length > 0
      ? simulatedRoute
      : corridor;
  const plannedRoute = planned.length > 0 ? planned : plannedFallback;
  const from = plannedRoute.length > 0 ? plannedRoute : to;
  return { from, to };
}

function trajectoryKind(snapshot: RunSnapshot, shipment: JsonObject | undefined): TrajectoryShiftKind {
  const selectedAction = snapshot.publicAgentSummary?.selectedAction;
  const state = shipmentState(shipment);
  const quote = asObject(snapshot.artifacts.routeQuote?.value);
  const quoteOperation = textValue(quote?.operation).toUpperCase();

  if (selectedAction === 'reroute' || state.includes('rerout')) return 'reroute';
  if (quoteOperation === 'REQUOTE') return 'requote';
  return 'disruption';
}

function shouldExposeTrajectory(
  snapshot: RunSnapshot,
  shipment: JsonObject | undefined,
): boolean {
  const state = shipmentState(shipment);
  const quote = asObject(snapshot.artifacts.routeQuote?.value);
  const quoteOperation = textValue(quote?.operation).toUpperCase();
  const currentId = snapshot.currentStepId ?? '';

  return (
    disruptionPresent(shipment)
    || state.includes('rerout')
    || state.includes('disrupt')
    || snapshot.publicAgentSummary?.selectedAction === 'reroute'
    || quoteOperation === 'REQUOTE'
    || currentId.includes('disrupt')
    || currentId.includes('choose-response')
  );
}

function highlightAgentStep(
  steps: StepDefinition[],
  snapshot: RunSnapshot,
): string | null {
  const current = steps.find((step) => step.id === snapshot.currentStepId);
  if (current?.owner === 'agent') return current.id;

  const completedAgent = [...steps]
    .reverse()
    .find((step) => (
      snapshot.completedStepIds.includes(step.id)
      && step.owner === 'agent'
      && (
        step.capabilities.includes('incident.explain')
        || step.kind === 'monitor'
        || step.id.includes('disrupt')
        || step.id.includes('explain')
      )
    ));
  if (completedAgent) return completedAgent.id;

  const lastCompletedAgent = [...steps]
    .reverse()
    .find((step) => snapshot.completedStepIds.includes(step.id) && step.owner === 'agent');
  if (lastCompletedAgent) return lastCompletedAgent.id;

  return steps.find((step) => step.owner === 'agent' && !snapshot.skippedStepIds.includes(step.id))?.id
    ?? null;
}

export function buildDispatchJourney(
  flow: FlowDefinition | null,
  snapshot: RunSnapshot,
): DispatchJourney {
  const steps = flow?.steps ?? inferredSteps(snapshot);
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === snapshot.currentStepId),
  );
  const denominator = Math.max(1, steps.length - 1);
  const progressPercent = Math.min(100, (currentIndex / denominator) * 100);
  const shipment = asObject(snapshot.artifacts.shipment?.value);
  const { from, to } = routesFromSnapshot(snapshot);
  const exposeShift = shouldExposeTrajectory(snapshot, shipment);
  const highlightedStepId = exposeShift ? highlightAgentStep(steps, snapshot) : null;
  const trajectoryShift: DispatchTrajectoryShift | null = exposeShift
    ? {
        kind: trajectoryKind(snapshot, shipment),
        from,
        to,
        agentLabel: agentLabel(snapshot.publicAgentSummary),
        summary:
          snapshot.publicAgentSummary?.summary
          ?? textValue(shipment?.disruption, 'The dispatch corridor is no longer the planned route.'),
        highlightedStepId,
      }
    : null;

  return {
    steps: steps.map((step) => ({
      stepId: step.id,
      title: step.title,
      description: step.description,
      owner: step.owner,
      kind: step.kind,
      status: journeyStepStatus(step, snapshot),
      agentHighlighted: highlightedStepId === step.id,
    })),
    currentIndex,
    progressPercent,
    trajectoryShift,
  };
}
