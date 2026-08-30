import type { FlowDefinition, FlowTransition, StepDefinition } from '@/lib/runtime/contracts';

const steps: StepDefinition[] = [
  {
    schemaVersion: '1.0',
    id: 'extract-order',
    title: 'Understand the Muebles del Sur order',
    description: 'Extract the product, destination, service promise and commercial inputs.',
    kind: 'extract',
    capabilities: ['route.view', 'quote.view', 'audit.view'],
    owner: 'agent',
    tool: { id: 'agent.extract' },
    presentation: { layout: 'focus', priority: 'normal', focus: 'route.view' },
  },
  {
    schemaVersion: '1.0',
    id: 'prepare-booking',
    title: 'Prepare booking and transport documents',
    description: 'Create the booking and Bill of Lading artifacts for the selected route.',
    kind: 'extract',
    capabilities: ['booking.view', 'document.view', 'quote.view'],
    owner: 'agent',
    tool: { id: 'route.pricing.quote' },
    presentation: { layout: 'split', priority: 'normal', focus: 'booking.view' },
  },
  {
    schemaVersion: '1.0',
    id: 'confirm-booking',
    title: 'Confirm booking',
    description: 'Confirm the prepared booking after all preceding validations pass.',
    kind: 'fulfill',
    capabilities: ['booking.view', 'audit.view'],
    owner: 'system',
    presentation: { layout: 'receipt', priority: 'normal', focus: 'booking.view' },
  },
  {
    schemaVersion: '1.0',
    id: 'monitor-shipment',
    title: 'Monitor the shipment',
    description: 'Track route, container milestones and ETA, enriched with current transport traffic when available.',
    kind: 'monitor',
    capabilities: ['route.view', 'container.track', 'audit.view'],
    owner: 'agent',
    tool: { id: 'mock.nauta.track' },
    presentation: { layout: 'timeline', priority: 'normal', focus: 'container.track' },
  },
  {
    schemaVersion: '1.0',
    id: 'explain-disruption',
    title: 'Explain the operational disruption',
    description: 'Combine historical evidence, current context and simulated present-day consequences.',
    kind: 'monitor',
    capabilities: ['route.view', 'incident.explain', 'audit.view'],
    owner: 'agent',
    when: {
      all: [{ path: 'shipment.disruption', operator: 'not_equals', value: 'NONE' }],
    },
    tool: { id: 'mock.nauta.milestones' },
    presentation: { layout: 'focus', priority: 'critical', focus: 'incident.explain' },
  },
  {
    schemaVersion: '1.0',
    id: 'choose-response',
    title: 'Choose the recovery response',
    description: 'A human decides whether to reroute, hold or escalate the disrupted shipment.',
    kind: 'decide',
    capabilities: ['route.view', 'quote.view', 'decision.request', 'audit.view'],
    owner: 'human',
    when: {
      all: [{ path: 'shipment.disruption', operator: 'not_equals', value: 'NONE' }],
    },
    presentation: { layout: 'split', priority: 'critical', focus: 'decision.request' },
  },
  {
    schemaVersion: '1.0',
    id: 'fulfill-delivery',
    title: 'Complete delivery',
    description: 'Confirm the resulting delivery plan and preserve its audit evidence.',
    kind: 'fulfill',
    capabilities: ['route.view', 'delivery.confirm', 'notification.view', 'audit.view'],
    owner: 'system',
    presentation: { layout: 'receipt', priority: 'normal', focus: 'delivery.confirm' },
  },
];

const transitions: FlowTransition[] = [
  { fromStepId: 'extract-order', outcome: 'success', toStepId: 'prepare-booking' },
  { fromStepId: 'prepare-booking', outcome: 'success', toStepId: 'confirm-booking' },
  { fromStepId: 'confirm-booking', outcome: 'success', toStepId: 'monitor-shipment' },
  { fromStepId: 'monitor-shipment', outcome: 'success', toStepId: 'explain-disruption' },
  { fromStepId: 'explain-disruption', outcome: 'success', toStepId: 'choose-response' },
  { fromStepId: 'explain-disruption', outcome: 'skipped', toStepId: 'fulfill-delivery' },
  { fromStepId: 'choose-response', outcome: 'reroute', toStepId: 'fulfill-delivery' },
  { fromStepId: 'choose-response', outcome: 'release', toStepId: 'fulfill-delivery' },
  { fromStepId: 'choose-response', outcome: 'approve-exception', toStepId: 'fulfill-delivery' },
  { fromStepId: 'fulfill-delivery', outcome: 'success', toStepId: null },
];

export const mueblesDelSurFlow: FlowDefinition = {
  schemaVersion: '1.0',
  id: 'muebles-del-sur-global-delivery',
  version: 1,
  name: 'Muebles del Sur global delivery',
  description:
    'A flow-native international order journey that recomposes the interface as operational truth changes.',
  entryStepId: 'extract-order',
  steps,
  transitions,
  metadata: {
    customer: 'Muebles del Sur',
    runtime: 'RouteShift',
    persistence: 'IN_MEMORY_NON_DURABLE',
    truthPolicy: 'EXPLICIT_CLASSIFICATION',
  },
};

export type DemoFlowPhase = 'BOOKING_PREPARATION' | 'VESSEL_DEPARTED' | 'UNEXPECTED_TRANSSHIPMENT';

export function flowForDemoPhase(phase: DemoFlowPhase): FlowDefinition {
  const flow = structuredClone(mueblesDelSurFlow);
  flow.metadata = { ...flow.metadata, demoPhase: phase };

  if (phase === 'BOOKING_PREPARATION') {
    flow.entryStepId = 'extract-order';
    flow.transitions = flow.transitions.map((transition) =>
      transition.fromStepId === 'prepare-booking' && transition.outcome === 'success'
        ? { ...transition, toStepId: null }
        : transition,
    );
  } else if (phase === 'VESSEL_DEPARTED') {
    flow.entryStepId = 'monitor-shipment';
    flow.transitions = flow.transitions.map((transition) =>
      transition.fromStepId === 'monitor-shipment' && transition.outcome === 'success'
        ? { ...transition, toStepId: null }
        : transition,
    );
  } else {
    flow.entryStepId = 'explain-disruption';
  }

  return flow;
}
