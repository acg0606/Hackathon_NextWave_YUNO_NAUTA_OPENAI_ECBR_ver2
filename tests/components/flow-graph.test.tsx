// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FlowGraph } from '@/components/runtime/FlowGraph';
import { mueblesDelSurFlow } from '@/lib/flows/muebles-del-sur';
import { makeSnapshot } from '@/tests/fixtures/runtime-fixtures';

afterEach(cleanup);

describe('FlowGraph', () => {
  it('renders every flow step with its owner', () => {
    const snapshot = makeSnapshot(mueblesDelSurFlow.steps[1], {
      currentStepId: 'prepare-booking',
      completedStepIds: ['extract-order'],
    });

    render(<FlowGraph flow={mueblesDelSurFlow} snapshot={snapshot} />);

    expect(screen.getByRole('navigation', { name: 'Dispatch journey' })).toBeTruthy();
    expect(screen.getByText('Understand the Muebles del Sur order')).toBeTruthy();
    expect(screen.getByText('Prepare booking and transport documents')).toBeTruthy();
    expect(screen.getAllByText('Agent').length).toBeGreaterThan(0);
    expect(screen.queryByText('Agent changed the dispatch trajectory')).toBeNull();
  });

  it('highlights the agent and shows the planned versus current corridor', () => {
    const snapshot = makeSnapshot(mueblesDelSurFlow.steps[4], {
      currentStepId: 'explain-disruption',
      completedStepIds: ['extract-order', 'prepare-booking', 'confirm-booking', 'monitor-shipment'],
      publicAgentSummary: {
        summary: 'Ari proposes London as the recovery gateway.',
        evidence: ['HISTORICAL_FACT'],
        providerMode: 'live',
        model: 'gpt-5-mini',
      },
      artifacts: {
        shipment: {
          id: 'shipment',
          kind: 'shipment',
          value: {
            origin: 'Frankfurt',
            destination: 'Atlanta',
            plannedRoute: ['FRA', 'ATL'],
            route: ['FRA', 'LHR', 'ATL'],
            disruption: 'Delta / CrowdStrike',
            state: 'disrupted',
          },
          truth: 'HISTORICAL_FACT',
          revision: 5,
          updatedAt: '2026-08-30T12:00:00.000Z',
        },
      },
    });

    const { container } = render(<FlowGraph flow={mueblesDelSurFlow} snapshot={snapshot} />);

    expect(screen.getByText('Agent detected a dispatch change')).toBeTruthy();
    expect(screen.getByText('Ari · gpt-5-mini')).toBeTruthy();
    expect(screen.getByText('FRA → ATL')).toBeTruthy();
    expect(screen.getByText('FRA → LHR → ATL')).toBeTruthy();
    expect(container.querySelector('li.is-agent')).toBeTruthy();
    expect(container.querySelector('li.is-agent')?.textContent).toContain('Explain the operational disruption');
  });
});
