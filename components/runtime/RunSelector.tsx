'use client';

import { AlertTriangle, ArrowRight, Box, Clock3, FileCheck2, MapPin, Ship, Sparkles } from 'lucide-react';
import { useMemo, useState, type SyntheticEvent } from 'react';
import type { RunStatus } from '@/lib/runtime/contracts';

export type RuntimeRunSummary = {
  runId: string;
  name: string;
  description?: string;
  status: RunStatus;
  revision: number;
  currentStepTitle?: string;
};

const demoRunOptions = [
  {
    id: 'booking-preparation',
    label: 'Booking preparation',
    detail: 'Order extraction, transparent route quote, and transport documents',
    icon: FileCheck2,
  },
  {
    id: 'vessel-departed',
    label: 'Vessel departed',
    detail: 'Container milestones, route, and ETA monitoring',
    icon: Ship,
  },
  {
    id: 'unexpected-transshipment',
    label: 'Unexpected transshipment',
    detail: 'Nine-day delay and a human operating decision',
    icon: AlertTriangle,
  },
] as const;

export type DemoRunPreset = (typeof demoRunOptions)[number]['id'];

export type OrderConfiguration = {
  product: string;
  productValueUsd: number;
  destination: string;
  destinationCoordinates: [number, number];
  transportMode: 'AIR' | 'OCEAN' | 'OCEAN_ROAD' | 'RAIL_OCEAN';
  promiseDays: number;
  useYunoSandbox: boolean;
};

const destinations = [
  { id: 'gaziantep', label: 'Gaziantep', coordinates: [37.3781, 37.0662] as [number, number] },
  { id: 'rotterdam', label: 'Rotterdam', coordinates: [4.4777, 51.9244] as [number, number] },
  { id: 'atlanta', label: 'Atlanta', coordinates: [-84.4277, 33.6407] as [number, number] },
] as const;

const products = [
  { label: 'Industrial furniture components', value: 72_000 },
  { label: 'Architectural lighting', value: 46_000 },
  { label: 'Premium dining chairs', value: 38_000 },
] as const;

export type RunSelectorProps = {
  runs: RuntimeRunSummary[];
  activeRunId: string | null;
  busyPreset?: string | null;
  onSelect: (runId: string) => void;
  onCreate: (preset: DemoRunPreset, configuration?: OrderConfiguration) => void;
};

function statusLabel(status: RunStatus) {
  if (status === 'awaiting_human') return 'Human decision';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function RunSelector({ runs, activeRunId, busyPreset, onSelect, onCreate }: RunSelectorProps) {
  const [productIndex, setProductIndex] = useState(0);
  const [destinationId, setDestinationId] = useState<(typeof destinations)[number]['id']>('gaziantep');
  const [longitudeText, setLongitudeText] = useState(String(destinations[0].coordinates[0]));
  const [latitudeText, setLatitudeText] = useState(String(destinations[0].coordinates[1]));
  const [transportMode, setTransportMode] = useState<OrderConfiguration['transportMode']>('OCEAN_ROAD');
  const [promiseDays, setPromiseDays] = useState(30);
  const [useYunoSandbox, setUseYunoSandbox] = useState(true);
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const destination = destinations.find((item) => item.id === destinationId) ?? destinations[0];
  const product = products[productIndex] ?? products[0];
  const illustrativeQuote = useMemo(() => {
    const modeFactor = transportMode === 'AIR' ? 0.075 : transportMode === 'RAIL_OCEAN' ? 0.035 : 0.026;
    return Math.round(product.value * modeFactor + promiseDays * 18);
  }, [product.value, promiseDays, transportMode]);

  function selectDestination(id: string) {
    const next = destinations.find((item) => item.id === id) ?? destinations[0];
    setDestinationId(next.id);
    setLongitudeText(String(next.coordinates[0]));
    setLatitudeText(String(next.coordinates[1]));
    setCoordinateError(null);
  }

  function validCoordinates() {
    const longitude = Number(longitudeText);
    const latitude = Number(latitudeText);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      setCoordinateError('Enter a latitude from −90 to 90 and a longitude from −180 to 180.');
      return null;
    }
    setCoordinateError(null);
    return [longitude, latitude] as [number, number];
  }

  function submitOrder(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const destinationCoordinates = validCoordinates();
    if (!destinationCoordinates) return;
    onCreate('booking-preparation', {
      product: product.label,
      productValueUsd: product.value,
      destination: destination.label,
      destinationCoordinates,
      transportMode,
      promiseDays,
      useYunoSandbox,
    });
  }

  return (
    <section className="runtime-run-selector" aria-labelledby="run-selector-title">
      <div className="runtime-run-selector__heading">
        <Sparkles aria-hidden="true" />
        <div>
          <h2 id="run-selector-title">Live operation</h2>
          <p>Each lane is an isolated runtime, not a frontend scene.</p>
        </div>
      </div>

      {runs.length > 0 ? (
        <ul className="runtime-run-selector__runs" aria-label="Available runs">
          {runs.map((run) => (
            <li key={run.runId}>
              <button
                aria-pressed={run.runId === activeRunId}
                className={run.runId === activeRunId ? 'is-active' : ''}
                type="button"
                onClick={() => onSelect(run.runId)}
              >
                <span className="runtime-run-selector__signal" aria-hidden="true" />
                <span>
                  <strong>{run.name}</strong>
                  <small>{run.currentStepTitle ?? statusLabel(run.status)}</small>
                </span>
                <span className="runtime-run-selector__revision">r{run.revision}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="runtime-run-selector__empty">
          <Clock3 aria-hidden="true" />
          <p>No run is active yet. Launch one of the three judge-ready operations.</p>
        </div>
      )}

      <form className="runtime-order-composer" onSubmit={submitOrder}>
        <header>
          <Box aria-hidden="true" />
          <div>
            <h3>Buy an international delivery</h3>
            <p>Configure the order; the flow will create the quote, documents, and operational interface.</p>
          </div>
          <span>ROUTESHIFT · SIMULATED QUOTE</span>
        </header>
        <div className="runtime-order-composer__fields">
          <label>
            <span>Product</span>
            <select value={productIndex} onChange={(event) => setProductIndex(Number(event.target.value))}>
              {products.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>Destination</span>
            <select value={destinationId} onChange={(event) => selectDestination(event.target.value)}>
              {destinations.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>Transport mode</span>
            <select value={transportMode} onChange={(event) => setTransportMode(event.target.value as OrderConfiguration['transportMode'])}>
              <option value="OCEAN_ROAD">Ocean + road</option>
              <option value="OCEAN">Ocean</option>
              <option value="RAIL_OCEAN">Rail + ocean</option>
              <option value="AIR">Air</option>
            </select>
          </label>
          <label>
            <span>Promise</span>
            <select value={promiseDays} onChange={(event) => setPromiseDays(Number(event.target.value))}>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={45}>45 days</option>
            </select>
          </label>
        </div>
        <fieldset className="runtime-order-composer__coordinates">
          <legend><MapPin aria-hidden="true" /> Destination coordinates</legend>
          <label>
            <span>Latitude</span>
            <input inputMode="decimal" value={latitudeText} onChange={(event) => setLatitudeText(event.target.value)} onBlur={validCoordinates} />
          </label>
          <label>
            <span>Longitude</span>
            <input inputMode="decimal" value={longitudeText} onChange={(event) => setLongitudeText(event.target.value)} onBlur={validCoordinates} />
          </label>
        </fieldset>
        {coordinateError ? <p className="runtime-order-composer__error" role="alert">{coordinateError}</p> : null}
        <label aria-label="Use Yuno Sandbox when configured" className="runtime-order-composer__sandbox" htmlFor="use-yuno-sandbox">
          <input
            checked={useYunoSandbox}
            id="use-yuno-sandbox"
            type="checkbox"
            onChange={(event) => setUseYunoSandbox(event.target.checked)}
          />
          <span><strong>Use Yuno Sandbox when configured</strong><small>Creates a test payment link only. No production funds or accounting.</small></span>
        </label>
        <footer>
          <div><small>Illustrative route quote</small><strong>US${illustrativeQuote.toLocaleString('en-US')}</strong></div>
          <button className="runtime-button runtime-button--primary" disabled={Boolean(busyPreset)} type="submit">
            {busyPreset === 'booking-preparation' ? 'Creating delivery…' : 'Buy delivery'} <ArrowRight aria-hidden="true" />
          </button>
        </footer>
      </form>

      <div className="runtime-run-selector__presets" aria-label="Create demo run">
        {demoRunOptions.map((preset) => {
          const Icon = preset.icon;
          return (
            <button
              disabled={Boolean(busyPreset)}
              key={preset.id}
              type="button"
              onClick={() => onCreate(preset.id)}
            >
              <Icon aria-hidden="true" />
              <span><strong>{preset.label}</strong><small>{preset.detail}</small></span>
              {busyPreset === preset.id ? <span className="runtime-inline-loader">Creating…</span> : <ArrowRight aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default RunSelector;
