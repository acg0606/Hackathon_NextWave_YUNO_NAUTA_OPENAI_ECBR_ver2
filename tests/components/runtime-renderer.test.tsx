// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeRenderer } from '@/components/runtime/RuntimeRenderer';
import type { RuntimeUISpec } from '@/lib/runtime/contracts';

afterEach(cleanup);

const action = {
  actionId: 'request-corrected-document',
  label: 'Request corrected B/L',
  intent: 'request-corrected-document' as const,
};

const mismatchSpec: RuntimeUISpec = {
  schemaVersion: '1.0',
  runId: 'run-renderer-proof',
  revision: 42,
  flowVersion: 2,
  layout: 'split',
  priority: 'critical',
  ownership: 'human',
  focusTarget: 'comparison',
  truthContext: ['SIMULATED_IF_TODAY', 'MOCK_CONNECTOR'],
  sections: [
    {
      id: 'comparison',
      type: 'document-comparison',
      title: 'Booking versus Bill of Lading',
      truth: 'SIMULATED_IF_TODAY',
      data: {
        differences: [
          {
            field: 'portOfDischarge',
            expected: 'TRISK',
            actual: 'TRMER',
            matches: false,
            blocking: true,
          },
          {
            field: 'grossWeightKg',
            expected: 18240,
            actual: 19050,
            matches: false,
            blocking: true,
          },
        ],
      },
    },
    {
      id: 'decision',
      type: 'decision',
      title: 'Resolve the blocking document differences',
      truth: 'SIMULATED_IF_TODAY',
      data: {
        decisionId: 'decision-random-step',
        explanation:
          'Confirmation is paused until a permitted human action is recorded.',
      },
    },
  ],
  allowedActions: [action],
};

describe('RuntimeRenderer', () => {
  it('composes the semantic comparison and sends only an allowlisted action', () => {
    const onAction = vi.fn();
    render(<RuntimeRenderer onAction={onAction} spec={mismatchSpec} />);

    expect(screen.getByText('2 differences detected')).toBeTruthy();
    expect(screen.getByText('TRISK')).toBeTruthy();
    expect(screen.getByText('TRMER')).toBeTruthy();
    expect(screen.getByText('18,240')).toBeTruthy();
    expect(screen.getByText('19,050')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Request corrected B/L' }),
    );
    expect(onAction).toHaveBeenCalledWith(action, {
      decisionId: 'decision-random-step',
    });
  });

  it('removes obsolete decision controls when the semantic specification changes', () => {
    const onAction = vi.fn();
    const rendered = render(
      <RuntimeRenderer onAction={onAction} spec={mismatchSpec} />,
    );
    expect(
      screen.getByRole('button', { name: 'Request corrected B/L' }),
    ).toBeTruthy();

    const resolvedSpec: RuntimeUISpec = {
      ...mismatchSpec,
      revision: 57,
      priority: 'normal',
      ownership: 'agent',
      focusTarget: 'result',
      sections: [
        {
          id: 'result',
          type: 'action-result',
          title: 'Validation resumed',
          truth: 'MOCK_CONNECTOR',
          data: {
            result: 'Corrected Bill of Lading accepted',
            summary: 'The same run resumed and confirmation can continue.',
          },
        },
      ],
      allowedActions: [],
    };
    rendered.rerender(
      <RuntimeRenderer onAction={onAction} spec={resolvedSpec} />,
    );

    expect(
      screen.queryByRole('button', { name: 'Request corrected B/L' }),
    ).toBeNull();
    expect(screen.queryByText('Booking versus Bill of Lading')).toBeNull();
    expect(screen.getByText('Corrected Bill of Lading accepted')).toBeTruthy();
  });

  it('renders only canonical allowlisted evidence links', () => {
    const evidenceSpec: RuntimeUISpec = {
      ...mismatchSpec,
      focusTarget: 'evidence',
      sections: [
        {
          id: 'evidence',
          type: 'evidence',
          title: 'Evidence boundary',
          data: {
            items: [
              {
                sourceTitle: 'Curated NASA source',
                sourceUrl: 'https://eonet.gsfc.nasa.gov/',
              },
              {
                sourceTitle: 'Scheme normalization bypass',
                sourceUrl: 'https:evil.com',
              },
              {
                sourceTitle: 'Backslash normalization bypass',
                sourceUrl: String.raw`http:\\evil.com`,
              },
              {
                sourceTitle: 'Arbitrary HTTPS host',
                sourceUrl: 'https://attacker.invalid/evidence',
              },
            ],
          },
        },
      ],
      allowedActions: [],
    };

    render(<RuntimeRenderer onAction={vi.fn()} spec={evidenceSpec} />);

    expect(
      screen
        .getByRole('link', { name: 'Open Curated NASA source in a new tab' })
        .getAttribute('href'),
    ).toBe('https://eonet.gsfc.nasa.gov/');
    expect(
      screen.queryByRole('link', {
        name: 'Open Scheme normalization bypass in a new tab',
      }),
    ).toBeNull();
    expect(
      screen.queryByRole('link', {
        name: 'Open Backslash normalization bypass in a new tab',
      }),
    ).toBeNull();
    expect(
      screen.queryByRole('link', {
        name: 'Open Arbitrary HTTPS host in a new tab',
      }),
    ).toBeNull();
  });
});
