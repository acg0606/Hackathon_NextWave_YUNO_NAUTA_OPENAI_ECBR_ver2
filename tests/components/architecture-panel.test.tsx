// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchitecturePanel } from '@/components/runtime/ArchitecturePanel';

afterEach(cleanup);

describe('ArchitecturePanel', () => {
  it('shows the real runtime sequence, live run proof, and explicit truth boundaries', () => {
    const onClose = vi.fn();
    render(
      <ArchitecturePanel
        onClose={onClose}
        open
        runtimeProof={{
          runId: 'run-proof-architecture',
          flowVersion: 4,
          revision: 27,
          status: 'awaiting_human',
          currentStepId: 'review-disruption',
          owner: 'human',
        }}
      />,
    );

    expect(
      screen.getByText('The flow is the source of the experience.'),
    ).toBeTruthy();
    expect(screen.getByText('run-proof-architecture')).toBeTruthy();
    expect(screen.getByText('FlowEngine + agent')).toBeTruthy();
    expect(screen.getByText('Same-run continuation:')).toBeTruthy();
    expect(screen.getByText('External sandbox')).toBeTruthy();
    expect(screen.getByText('Mock connector')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Close architecture and flow' }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
