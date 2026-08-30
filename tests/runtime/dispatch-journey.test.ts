import { describe, expect, it } from 'vitest';

import { mueblesDelSurFlow } from '@/lib/flows/muebles-del-sur';
import { buildDispatchJourney } from '@/lib/runtime/dispatch-journey';
import { makeSnapshot } from '@/tests/fixtures/runtime-fixtures';

describe('dispatch journey', () => {
  it('keeps a quiet rail while the planned corridor is intact', () => {
    const snapshot = makeSnapshot(mueblesDelSurFlow.steps[0], {
      currentStepId: 'prepare-booking',
      completedStepIds: ['extract-order'],
      artifacts: {
        shipment: {
          id: 'shipment',
          kind: 'shipment',
          value: {
            origin: 'Shanghai',
            destination: 'Gaziantep',
            route: ['Shanghai', 'Iskenderun', 'Gaziantep'],
            plannedRoute: ['Shanghai', 'Iskenderun', 'Gaziantep'],
            disruption: 'NONE',
            state: 'in-transit',
          },
          truth: 'MOCK_CONNECTOR',
          revision: 2,
          updatedAt: '2026-08-30T12:00:00.000Z',
        },
      },
    });

    const journey = buildDispatchJourney(mueblesDelSurFlow, snapshot);
    expect(journey.trajectoryShift).toBeNull();
    expect(journey.steps.map((step) => step.owner)).toContain('agent');
    expect(journey.steps.every((step) => step.agentHighlighted === false)).toBe(true);
  });

  it('does not treat extra transit waypoints as a dispatch change', () => {
    const snapshot = makeSnapshot(mueblesDelSurFlow.steps[3], {
      currentStepId: 'monitor-shipment',
      completedStepIds: ['extract-order', 'prepare-booking', 'confirm-booking'],
      artifacts: {
        shipment: {
          id: 'shipment',
          kind: 'shipment',
          value: {
            origin: 'Shanghai',
            destination: 'Gaziantep',
            plannedRoute: ['Shanghai', 'Iskenderun', 'Gaziantep'],
            route: ['Shanghai', 'Singapore', 'Iskenderun', 'Gaziantep'],
            disruption: 'NONE',
            state: 'in-transit',
          },
          truth: 'MOCK_CONNECTOR',
          revision: 4,
          updatedAt: '2026-08-30T12:00:00.000Z',
        },
      },
    });

    expect(buildDispatchJourney(mueblesDelSurFlow, snapshot).trajectoryShift).toBeNull();
  });

  it('exposes the trajectory change and highlights the agent step', () => {
    const snapshot = makeSnapshot(mueblesDelSurFlow.steps[4], {
      currentStepId: 'explain-disruption',
      completedStepIds: ['extract-order', 'prepare-booking', 'confirm-booking', 'monitor-shipment'],
      status: 'running',
      publicAgentSummary: {
        summary: 'The planned Iskenderun corridor is closed. Ari proposes Mersin.',
        evidence: ['HISTORICAL_FACT'],
        providerId: 'openai-structured-agent-v1',
        providerMode: 'live',
        model: 'gpt-5-mini',
      },
      artifacts: {
        shipment: {
          id: 'shipment',
          kind: 'shipment',
          value: {
            origin: 'Shanghai',
            destination: 'Gaziantep',
            plannedRoute: ['Shanghai', 'Iskenderun', 'Gaziantep'],
            route: ['Shanghai', 'Mersin', 'Gaziantep'],
            disruption: 'Iskenderun earthquake',
            state: 'disrupted',
          },
          truth: 'HISTORICAL_FACT',
          revision: 6,
          updatedAt: '2026-08-30T12:00:00.000Z',
        },
      },
    });

    const journey = buildDispatchJourney(mueblesDelSurFlow, snapshot);
    expect(journey.trajectoryShift).toMatchObject({
      kind: 'disruption',
      from: ['Shanghai', 'Iskenderun', 'Gaziantep'],
      to: ['Shanghai', 'Mersin', 'Gaziantep'],
      agentLabel: 'Ari · gpt-5-mini',
    });
    const highlighted = journey.steps.find((step) => step.agentHighlighted);
    expect(highlighted?.stepId).toBe('explain-disruption');
    expect(highlighted?.owner).toBe('agent');
  });

  it('names a reroute as an agent trajectory change', () => {
    const snapshot = makeSnapshot(mueblesDelSurFlow.steps[6], {
      currentStepId: 'fulfill-delivery',
      completedStepIds: [
        'extract-order',
        'prepare-booking',
        'confirm-booking',
        'monitor-shipment',
        'explain-disruption',
        'choose-response',
      ],
      status: 'running',
      publicAgentSummary: {
        summary: 'The approved reroute was simulated through the Nauta pattern.',
        evidence: ['Nauta mock operation: REROUTED'],
        selectedAction: 'reroute',
        providerId: 'route-shift-runtime-v1',
        providerMode: 'deterministic_fallback',
      },
      artifacts: {
        shipment: {
          id: 'shipment',
          kind: 'shipment',
          value: {
            origin: 'Shanghai',
            destination: 'Gaziantep',
            plannedRoute: ['Shanghai', 'Iskenderun', 'Gaziantep'],
            route: ['Shanghai', 'Dubai air gateway', 'Gaziantep'],
            disruption: 'NONE',
            state: 'rerouted',
          },
          truth: 'MOCK_CONNECTOR',
          revision: 9,
          updatedAt: '2026-08-30T12:00:00.000Z',
        },
      },
    });

    const journey = buildDispatchJourney(mueblesDelSurFlow, snapshot);
    expect(journey.trajectoryShift?.kind).toBe('reroute');
    expect(journey.trajectoryShift?.to).toEqual(['Shanghai', 'Dubai air gateway', 'Gaziantep']);
    expect(journey.steps.find((step) => step.agentHighlighted)?.stepId).toBe('explain-disruption');
  });
});
