// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scenarios } from '@/app/scenarios';
import { HistoricalScenarioArchive } from '@/components/runtime/HistoricalScenarioArchive';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HistoricalScenarioArchive', () => {
  it('replays when the event card itself is clicked, not only Replay now', () => {
    const scenario = scenarios[0];
    const onReplay = vi.fn();
    render(
      <HistoricalScenarioArchive
        open
        replayFeedback={{ state: 'idle' }}
        onClose={vi.fn()}
        onReplay={onReplay}
      />,
    );

    fireEvent.click(screen.getByRole('heading', { name: scenario.shortName }));
    expect(onReplay).toHaveBeenCalledWith(scenario);
    onReplay.mockClear();

    fireEvent.click(screen.getByRole('link', { name: `Open source for ${scenario.shortName}` }));
    expect(onReplay).not.toHaveBeenCalled();
  });

  it('exposes the selected replay, progress, and duplicate-click protection', () => {
    const scenario = scenarios[0];
    const onReplay = vi.fn();
    const rendered = render(
      <HistoricalScenarioArchive
        open
        replayFeedback={{ state: 'idle' }}
        onClose={vi.fn()}
        onReplay={onReplay}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: `Replay ${scenario.shortName} now` }));
    expect(onReplay).toHaveBeenCalledWith(scenario);

    rendered.rerender(
      <HistoricalScenarioArchive
        open
        replayFeedback={{
          state: 'creating',
          scenarioId: scenario.id,
          scenarioName: scenario.shortName,
          idempotencyKey: crypto.randomUUID(),
        }}
        onClose={vi.fn()}
        onReplay={onReplay}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain(`Building the ${scenario.shortName} replay`);
    expect(screen.getByRole('button', { name: `Creating replay for ${scenario.shortName}` }).getAttribute('aria-busy')).toBe('true');
    for (const button of screen.getAllByRole('button', { name: /replay/i })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('keeps a failed replay visible and retries the same scenario', () => {
    const scenario = scenarios[2];
    const onReplay = vi.fn();
    render(
      <HistoricalScenarioArchive
        open
        replayFeedback={{
          state: 'error',
          scenarioId: scenario.id,
          scenarioName: scenario.shortName,
          idempotencyKey: crypto.randomUUID(),
          message: 'The runtime connection was interrupted. Your selection is preserved.',
        }}
        onClose={vi.fn()}
        onReplay={onReplay}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(`The ${scenario.shortName} replay did not start`);
    expect(alert.textContent).toContain('Your selection is preserved');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onReplay).toHaveBeenCalledWith(scenario);
    expect((screen.getByRole('button', { name: `Replay ${scenarios[0].shortName} now` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders a useful empty search state', () => {
    render(
      <HistoricalScenarioArchive
        open
        replayFeedback={{ state: 'idle' }}
        onClose={vi.fn()}
        onReplay={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Search all ten disruptions'), {
      target: { value: 'not-a-real-disruption' },
    });
    expect(screen.getByText(/No disruption matches this search/)).toBeTruthy();
  });
});
