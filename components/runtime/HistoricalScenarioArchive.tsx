'use client';

import { ArrowRight, ExternalLink, Newspaper, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { scenarios, type Scenario } from '@/app/scenarios';
import { TruthBadge } from './runtime-primitives';

export type HistoricalScenarioArchiveProps = {
  open: boolean;
  busyScenarioId?: string | null;
  selectedScenarioId?: string | null;
  onClose: () => void;
  onReplay: (scenario: Scenario) => void;
};

export function HistoricalScenarioArchive({
  open,
  busyScenarioId,
  selectedScenarioId,
  onClose,
  onReplay,
}: HistoricalScenarioArchiveProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');

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

  useEffect(() => () => previousFocusRef.current?.focus(), []);

  const filtered = scenarios.filter((scenario) => (
    `${scenario.shortName} ${scenario.category} ${scenario.place} ${scenario.year}`
      .toLowerCase()
      .includes(query.toLowerCase())
  ));

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
        previousFocusRef.current?.focus();
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

      <div className="runtime-scenario-grid">
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
              <button disabled={Boolean(busyScenarioId)} type="button" onClick={() => onReplay(scenario)}>
                {busyScenarioId === scenario.id ? 'Creating…' : 'Replay now'} <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>

      <footer>
        <TruthBadge truth="SIMULATED_IF_TODAY" />
        <span>A replay creates a new isolated in-memory run. It causes no external booking or payment action.</span>
      </footer>
    </dialog>
  );
}

export default HistoricalScenarioArchive;
