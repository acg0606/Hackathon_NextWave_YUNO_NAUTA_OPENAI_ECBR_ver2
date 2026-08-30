'use client';

import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  LoaderCircle,
  Newspaper,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { scenarios, type Scenario } from '@/app/scenarios';
import { TruthBadge } from './runtime-primitives';

export type HistoricalScenarioArchiveProps = {
  open: boolean;
  replayFeedback:
    | { state: 'idle' }
    | { state: 'creating'; scenarioId: string; scenarioName: string; idempotencyKey: string }
    | { state: 'error'; scenarioId: string; scenarioName: string; idempotencyKey: string; message: string };
  selectedScenarioId?: string | null;
  restoreFocusOnClose?: boolean;
  onClose: () => void;
  onReplay: (scenario: Scenario) => void;
};

export function HistoricalScenarioArchive({
  open,
  replayFeedback,
  selectedScenarioId,
  restoreFocusOnClose = true,
  onClose,
  onReplay,
}: HistoricalScenarioArchiveProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(restoreFocusOnClose);
  const [query, setQuery] = useState('');

  useEffect(() => {
    restoreFocusRef.current = restoreFocusOnClose;
  }, [restoreFocusOnClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      window.requestAnimationFrame(() => dialog.querySelector<HTMLInputElement>('input')?.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => () => {
    if (restoreFocusRef.current) previousFocusRef.current?.focus();
  }, []);

  const filtered = scenarios.filter((scenario) => (
    `${scenario.shortName} ${scenario.category} ${scenario.place} ${scenario.year}`
      .toLowerCase()
      .includes(query.toLowerCase())
  ));
  const busyScenarioId = replayFeedback.state === 'creating'
    ? replayFeedback.scenarioId
    : null;
  const failedScenario = replayFeedback.state === 'error'
    ? scenarios.find((scenario) => scenario.id === replayFeedback.scenarioId)
    : null;

  return (
    <dialog
      aria-labelledby="historical-archive-title"
      className="runtime-scenario-archive"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        setQuery('');
        if (restoreFocusRef.current) previousFocusRef.current?.focus();
      }}
    >
      <header>
        <div>
          <span><Newspaper aria-hidden="true" /> Historical disruption archive</span>
          <h2 id="historical-archive-title">Choose a past event. Run its consequences now.</h2>
          <p>Historical evidence stays dated. Route, ETA, cost, connector, and interface consequences are simulated.</p>
        </div>
        <button className="runtime-icon-button" type="button" onClick={onClose} aria-label="Close historical archive"><X /></button>
      </header>

      <label className="runtime-archive-search" htmlFor="historical-archive-search">
        <span>Search all ten disruptions</span>
        <div><Search aria-hidden="true" /><input id="historical-archive-search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      </label>

      {replayFeedback.state !== 'idle' ? (
        <section
          aria-live={replayFeedback.state === 'error' ? 'assertive' : 'polite'}
          className={`runtime-replay-feedback is-${replayFeedback.state}`}
          id="historical-replay-status"
          role={replayFeedback.state === 'error' ? 'alert' : 'status'}
        >
          {replayFeedback.state === 'creating' ? (
            <LoaderCircle aria-hidden="true" className="runtime-replay-feedback__spinner" />
          ) : (
            <AlertTriangle aria-hidden="true" />
          )}
          <div>
            <strong>
              {replayFeedback.state === 'creating'
                ? `Building the ${replayFeedback.scenarioName} replay`
                : `The ${replayFeedback.scenarioName} replay did not start`}
            </strong>
            <span>
              {replayFeedback.state === 'creating'
                ? 'Creating an isolated simulated run and composing its incident workspace. Keep this window open for a moment.'
                : replayFeedback.message}
            </span>
          </div>
          {replayFeedback.state === 'error' && failedScenario ? (
            <button type="button" onClick={() => onReplay(failedScenario)}>
              Try again <ArrowRight aria-hidden="true" />
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="runtime-scenario-grid" aria-busy={busyScenarioId ? 'true' : undefined}>
        {filtered.map((scenario, index) => (
          <article
            aria-current={selectedScenarioId === scenario.id ? 'true' : undefined}
            key={scenario.id}
            style={{ '--scenario-accent': scenario.accent } as React.CSSProperties}
          >
            <span className="runtime-scenario-grid__index">{String(index + 1).padStart(2, '0')}</span>
            <span className="runtime-scenario-grid__year">{scenario.year}</span>
            <h3>{scenario.shortName}</h3>
            <p>{scenario.category}</p>
            <small>{scenario.place}</small>
            <div className="runtime-scenario-grid__truth"><TruthBadge truth="HISTORICAL_FACT" /></div>
            <div className="runtime-scenario-grid__actions">
              <a href={scenario.sourceUrl} target="_blank" rel="noreferrer noopener" aria-label={`Open source for ${scenario.shortName}`}>
                Source <ExternalLink aria-hidden="true" />
              </a>
              <button
                aria-busy={busyScenarioId === scenario.id ? 'true' : undefined}
                aria-describedby={busyScenarioId === scenario.id ? 'historical-replay-status' : undefined}
                aria-label={busyScenarioId === scenario.id
                  ? `Creating replay for ${scenario.shortName}`
                  : `Replay ${scenario.shortName} now`}
                disabled={Boolean(busyScenarioId)}
                type="button"
                onClick={() => onReplay(scenario)}
              >
                {busyScenarioId === scenario.id ? (
                  <><LoaderCircle aria-hidden="true" className="runtime-replay-feedback__spinner" /> Building replay…</>
                ) : (
                  <>Replay now <ArrowRight aria-hidden="true" /></>
                )}
              </button>
            </div>
          </article>
        ))}
        {filtered.length === 0 ? (
          <p className="runtime-scenario-grid__empty">No disruption matches this search. Try a place, year, or event name.</p>
        ) : null}
      </div>

      <footer>
        <TruthBadge truth="SIMULATED_IF_TODAY" />
        <span>A replay creates a new isolated simulated run. It causes no external booking or payment action.</span>
      </footer>
    </dialog>
  );
}

export default HistoricalScenarioArchive;
