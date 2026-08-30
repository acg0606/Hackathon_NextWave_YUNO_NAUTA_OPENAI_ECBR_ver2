'use client';

import {
  AlertTriangle,
  ArrowRight,
  Box,
  Check,
  CircleDollarSign,
  Clock3,
  Container,
  ExternalLink,
  FileCheck2,
  FileWarning,
  Gauge,
  MapPinned,
  PackageCheck,
  ReceiptText,
  Radio,
  Route,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  AllowedAction,
  JsonObject,
  RuntimeUISection,
  RuntimeUISpec,
  TruthClassification,
} from '@/lib/runtime/contracts';
import { isSafeEvidenceUrl } from '@/lib/runtime/safe-url';

export type RuntimeActionContext = {
  decisionId?: string;
  input?: JsonObject;
};

export type RuntimeSectionComponentProps = {
  section: RuntimeUISection;
  spec: RuntimeUISpec;
  pendingActionId?: string | null;
  onAction: (action: AllowedAction, context?: RuntimeActionContext) => void;
};

const truthLabels: Record<TruthClassification, string> = {
  HISTORICAL_FACT: 'Historical fact',
  LIVE_CURRENT_CONTEXT: 'Live current context',
  EXTERNAL_SANDBOX: 'External sandbox',
  SIMULATED_IF_TODAY: 'Simulated if today',
  MOCK_CONNECTOR: 'Mock connector',
  UNKNOWN: 'Unknown',
};

export function TruthBadge({ truth }: { truth: TruthClassification }) {
  return (
    <span className={`runtime-truth runtime-truth--${truth.toLowerCase()}`}>
      {truthLabels[truth]}
    </span>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function firstValue(data: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return undefined;
}

function firstText(data: Record<string, unknown>, keys: string[], fallback = 'Not available') {
  const value = firstValue(data, keys);
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(toDisplayValue).join(' · ');
  return 'Structured record';
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeHref(value: unknown) {
  return isSafeEvidenceUrl(value) ? value : null;
}

function SectionFrame({
  section,
  icon,
  className,
  children,
}: {
  section: RuntimeUISection;
  icon: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`runtime-section ${className}`}
      aria-labelledby={`section-${section.id}`}
      data-section-id={section.id}
      data-section-type={section.type}
    >
      <header className="runtime-section__header">
        <span className="runtime-section__icon" aria-hidden="true">{icon}</span>
        <div>
          <h2 id={`section-${section.id}`}>{section.title ?? humanize(section.type)}</h2>
          {section.description ? <p>{section.description}</p> : null}
        </div>
        {section.truth ? <TruthBadge truth={section.truth} /> : null}
      </header>
      <div className="runtime-section__body">{children}</div>
    </section>
  );
}

function KeyValueList({ data, omit = [] }: { data: Record<string, unknown>; omit?: string[] }) {
  const entries = Object.entries(data).filter(([key, value]) => (
    !omit.includes(key)
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
  ));

  if (entries.length === 0) return <p className="runtime-empty-copy">No scalar details were emitted for this section.</p>;

  return (
    <dl className="runtime-key-values">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{humanize(key)}</dt>
          <dd>{toDisplayValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionButtons({
  actions,
  decisionId,
  pendingActionId,
  onAction,
}: {
  actions: AllowedAction[];
  decisionId?: string;
  pendingActionId?: string | null;
  onAction: RuntimeSectionComponentProps['onAction'];
}) {
  if (actions.length === 0) return null;

  return (
    <div className="runtime-action-row" aria-label="Available actions">
      {actions.map((action, index) => (
        <button
          className={index === 0 ? 'runtime-button runtime-button--primary' : 'runtime-button runtime-button--secondary'}
          disabled={Boolean(pendingActionId)}
          key={action.actionId}
          type="button"
          onClick={() => onAction(action, { decisionId })}
        >
          {pendingActionId === action.actionId ? 'Submitting…' : action.label}
          {index === 0 ? <ArrowRight aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (isRecord(item)) return firstText(item, ['label', 'name', 'title', 'location', 'status'], '');
      return '';
    })
    .filter(Boolean);
}

export function RouteMapSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const origin = firstText(record(data.origin), ['label', 'name'], firstText(data, ['origin'], 'Origin'));
  const destination = firstText(record(data.destination), ['label', 'name'], firstText(data, ['destination'], 'Destination'));
  const route = stringArray(firstValue(data, ['path', 'route', 'stops', 'waypoints']));
  const routeLabels = route.length > 0 ? route : [origin, destination];
  const state = firstText(data, ['state', 'status', 'routeState'], 'Planned');

  return (
    <SectionFrame section={section} icon={<MapPinned />} className="runtime-section--route">
      <div className="runtime-route-line" aria-label={`Route: ${routeLabels.join(' to ')}`}>
        {routeLabels.map((label, index) => (
          <div className={index === routeLabels.length - 1 ? 'is-current' : 'is-complete'} key={`${label}-${index}`}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>
      <div className="runtime-route-status">
        <Route aria-hidden="true" />
        <span>Route state</span>
        <strong>{state}</strong>
      </div>
    </SectionFrame>
  );
}

export function BookingSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const booking = record(firstValue(data, ['booking', 'value', 'record']) ?? data);
  return (
    <SectionFrame section={section} icon={<FileCheck2 />} className="runtime-section--booking">
      <KeyValueList data={booking} omit={['provenance']} />
    </SectionFrame>
  );
}

export function ContainerSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const container = record(firstValue(data, ['container', 'value', 'record']) ?? data);
  const milestonesValue = firstValue(data, ['milestones', 'events']);
  const milestones = Array.isArray(milestonesValue) ? milestonesValue : [];
  const liveEnvelope = record(data.liveContext);
  const liveContext = record(liveEnvelope.value);
  const liveObservations = Array.isArray(liveContext.observations)
    ? liveContext.observations.slice(0, 5)
    : [];
  const liveTruth = typeof liveEnvelope.truth === 'string'
    ? liveEnvelope.truth as TruthClassification
    : 'UNKNOWN';
  return (
    <SectionFrame section={section} icon={<Container />} className="runtime-section--container">
      <KeyValueList data={container} omit={['milestones', 'events', 'provenance']} />
      {milestones.length > 0 ? (
        <ol className="runtime-milestones">
          {milestones.map((item, index) => {
            const milestone = record(item);
            return (
              <li key={`${firstText(milestone, ['id', 'label', 'title'], 'milestone')}-${index}`}>
                <span aria-hidden="true"><Check /></span>
                <div>
                  <strong>{firstText(milestone, ['label', 'title', 'name'], `Milestone ${index + 1}`)}</strong>
                  <small>{firstText(milestone, ['time', 'timestamp', 'status'], 'Recorded')}</small>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {liveEnvelope.available === true ? (
        <div className="runtime-live-traffic">
          <header>
            <div><Radio aria-hidden="true" /><span>Current corridor traffic</span></div>
            <TruthBadge truth={liveTruth} />
          </header>
          <strong>{firstText(liveContext, ['provider'], 'Live provider')} · {firstText(liveContext, ['observationCount'], '0')} observations</strong>
          <p>{firstText(liveContext, ['publicNote'], 'Current traffic is contextual and is not proof of shipment assignment.')}</p>
          {liveObservations.length > 0 ? (
            <ul>
              {liveObservations.map((item, index) => {
                const observation = record(item);
                return (
                  <li key={`${firstText(observation, ['mmsi', 'hex', 'callsign'], 'observation')}-${index}`}>
                    <span>{firstText(observation, ['shipName', 'name', 'callsign', 'registration', 'mmsi', 'hex'], `Traffic ${index + 1}`)}</span>
                    <small>{firstText(observation, ['mmsi', 'hex', 'aircraftType', 'kind'], 'Current signal')}</small>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SectionFrame>
  );
}

export function ProgressSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const itemsValue = firstValue(data, ['items', 'steps', 'milestones']);
  const items = Array.isArray(itemsValue) ? itemsValue : [];
  const progressValue = firstValue(data, ['progress', 'percent', 'value']);
  const progress = typeof progressValue === 'number'
    ? Math.max(0, Math.min(100, progressValue <= 1 ? progressValue * 100 : progressValue))
    : null;
  return (
    <SectionFrame section={section} icon={<Waypoints />} className="runtime-section--progress">
      {progress !== null ? (
        <div className="runtime-progress" aria-label={`${Math.round(progress)} percent complete`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {items.length > 0 ? (
        <ol className="runtime-progress-list">
          {items.map((item, index) => {
            const entry = record(item);
            const status = firstText(entry, ['status', 'state'], index === 0 ? 'current' : 'pending');
            return (
              <li className={`is-${status.toLowerCase().replace(/\s+/g, '-')}`} key={`${firstText(entry, ['id', 'label', 'title'], 'step')}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{firstText(entry, ['label', 'title', 'name'], `Step ${index + 1}`)}</strong>
                  <small>{humanize(status)}</small>
                </div>
              </li>
            );
          })}
        </ol>
      ) : <KeyValueList data={data} />}
    </SectionFrame>
  );
}

export function AlertSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const severity = firstText(data, ['severity', 'priority'], 'warning');
  return (
    <SectionFrame section={section} icon={<AlertTriangle />} className={`runtime-section--alert is-${severity}`}>
      <p className="runtime-alert-copy">{firstText(data, ['summary', 'message', 'impact', 'reason'], section.description ?? 'The run requires attention.')}</p>
      <KeyValueList data={data} omit={['summary', 'message', 'impact', 'reason', 'severity', 'priority']} />
    </SectionFrame>
  );
}

export function EvidenceSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const sourcesValue = firstValue(data, ['sources', 'evidence', 'items']);
  const sources = Array.isArray(sourcesValue) ? sourcesValue : [data];
  return (
    <SectionFrame section={section} icon={<ReceiptText />} className="runtime-section--evidence">
      <ul className="runtime-evidence-list">
        {sources.map((item, index) => {
          const evidence = record(item);
          const href = safeHref(firstValue(evidence, ['sourceUrl', 'url', 'href']));
          const title = firstText(evidence, ['sourceTitle', 'title', 'label'], `Evidence ${index + 1}`);
          return (
            <li key={`${title}-${index}`}>
              <div>
                <strong>{title}</strong>
                <span>{firstText(evidence, ['summary', 'description', 'eventDate', 'publicationDate'], 'Source recorded in the run.')}</span>
              </div>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer noopener" aria-label={`Open ${title} in a new tab`}>
                  <ExternalLink aria-hidden="true" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </SectionFrame>
  );
}

export function QuoteSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const quote = record(data.value);
  const paymentEnvelope = record(data.payment);
  const payment = record(paymentEnvelope.value);
  const amount = firstText(quote, ['formattedAmount', 'revisedTotal', 'total', 'amount', 'price'], 'Illustrative quote');
  const paymentTruth = typeof paymentEnvelope.truth === 'string'
    ? paymentEnvelope.truth as TruthClassification
    : undefined;
  const checkoutHref = safeHref(payment.sourceUrl);
  return (
    <SectionFrame section={section} icon={<CircleDollarSign />} className="runtime-section--quote">
      <div className="runtime-commercial-hero">
        <span>{firstText(quote, ['currency', 'kind', 'status'], 'Simulated route quote')}</span>
        <strong>{amount}</strong>
        <p>{firstText(quote, ['explanation', 'summary', 'basis'], 'Calculated from the current simulated route and delivery promise.')}</p>
      </div>
      <KeyValueList data={quote} omit={['formattedAmount', 'total', 'amount', 'price', 'explanation', 'summary', 'basis']} />
      {paymentEnvelope.available === true || paymentEnvelope.status ? (
        <div className="runtime-payment-state">
          <div>
            <span>Payment orchestration</span>
            <strong>{firstText(payment, ['status'], firstText(paymentEnvelope, ['status'], 'Not requested'))}</strong>
          </div>
          {paymentTruth ? <TruthBadge truth={paymentTruth} /> : null}
          <p>{firstText(payment, ['publicNote'], 'No production funds or accounting are affected by this interface.')}</p>
          {checkoutHref ? (
            <a href={checkoutHref} target="_blank" rel="noreferrer noopener">
              Open Yuno Sandbox checkout <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
    </SectionFrame>
  );
}

export function RefundSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  return (
    <SectionFrame section={section} icon={<CircleDollarSign />} className="runtime-section--refund">
      <div className="runtime-commercial-hero">
        <span>{firstText(data, ['status', 'kind'], 'Mock refund')}</span>
        <strong>{firstText(data, ['formattedAmount', 'amount', 'difference'], 'Pending')}</strong>
        <p>{firstText(data, ['explanation', 'summary', 'reason'], 'No external payment action has been performed.')}</p>
      </div>
      <KeyValueList data={data} omit={['formattedAmount', 'amount', 'difference', 'explanation', 'summary', 'reason']} />
    </SectionFrame>
  );
}

type ComparisonRow = {
  field: string;
  expected: unknown;
  actual: unknown;
  matches: boolean;
  blocking: boolean;
};

function comparisonRows(data: Record<string, unknown>): ComparisonRow[] {
  const suppliedRows = firstValue(data, ['rows', 'comparisons', 'differences', 'discrepancies']);
  if (Array.isArray(suppliedRows)) {
    return suppliedRows.map((item, index) => {
      const row = record(item);
      const expected = firstValue(row, ['expected', 'bookingValue', 'left']);
      const actual = firstValue(row, ['actual', 'billOfLadingValue', 'right']);
      const matchesValue = firstValue(row, ['matches', 'match']);
      return {
        field: firstText(row, ['field', 'name', 'path'], `Field ${index + 1}`),
        expected,
        actual,
        matches: typeof matchesValue === 'boolean' ? matchesValue : expected === actual,
        blocking: firstValue(row, ['blocking', 'severity']) === true || firstText(row, ['severity'], '') === 'blocking',
      };
    });
  }

  const expected = record(firstValue(data, ['expected', 'booking']));
  const actual = record(firstValue(data, ['actual', 'billOfLading', 'bill_of_lading']));
  return Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)])).map((field) => ({
    field,
    expected: expected[field],
    actual: actual[field],
    matches: expected[field] === actual[field],
    blocking: expected[field] !== actual[field],
  }));
}

export function DocumentComparisonSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const rows = comparisonRows(data);
  const mismatchCount = rows.filter((row) => !row.matches).length;
  return (
    <SectionFrame section={section} icon={<FileWarning />} className="runtime-section--document-comparison">
      <div className="runtime-comparison-summary">
        <span>{mismatchCount === 0 ? <FileCheck2 /> : <FileWarning />}</span>
        <div>
          <strong>{mismatchCount === 0 ? 'Documents match' : `${mismatchCount} ${mismatchCount === 1 ? 'difference' : 'differences'} detected`}</strong>
          <p>{firstText(data, ['summary', 'explanation'], mismatchCount === 0 ? 'The booking and Bill of Lading agree.' : 'Confirmation is blocked until a human resolves the differences.')}</p>
        </div>
      </div>
      <div className="runtime-comparison-table-wrap">
        <table className="runtime-comparison-table">
          <caption className="sr-only">Document field comparison</caption>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Booking</th>
              <th scope="col">Bill of Lading</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className={row.matches ? 'is-match' : 'is-mismatch'} key={row.field}>
                <th scope="row">{humanize(row.field)}</th>
                <td>{toDisplayValue(row.expected)}</td>
                <td>{toDisplayValue(row.actual)}</td>
                <td>
                  {row.matches ? <><Check aria-hidden="true" /> Match</> : <><AlertTriangle aria-hidden="true" /> {row.blocking ? 'Blocking' : 'Review'}</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionFrame>
  );
}

export function DiscrepancySection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const itemsValue = firstValue(data, ['items', 'differences', 'discrepancies']);
  const items = Array.isArray(itemsValue) ? itemsValue : [];
  return (
    <SectionFrame section={section} icon={<AlertTriangle />} className="runtime-section--discrepancy">
      <ul className="runtime-discrepancy-list">
        {items.length > 0 ? items.map((item, index) => {
          const discrepancy = record(item);
          return (
            <li key={`${firstText(discrepancy, ['field', 'title', 'name'], 'difference')}-${index}`}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{humanize(firstText(discrepancy, ['field', 'title', 'name'], `Difference ${index + 1}`))}</strong>
                <p>{firstText(discrepancy, ['summary', 'message', 'description'], `${toDisplayValue(discrepancy.expected)} expected; ${toDisplayValue(discrepancy.actual)} received.`)}</p>
              </div>
              <small>{firstText(discrepancy, ['severity'], 'Review')}</small>
            </li>
          );
        }) : <li><div><strong>No discrepancies</strong><p>The current structured result contains no differences.</p></div></li>}
      </ul>
    </SectionFrame>
  );
}

export function ConfidenceSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const rawValue = firstValue(data, ['confidence', 'value', 'score']);
  const numericValue = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number.parseFloat(rawValue)
      : 0;
  const percent = Math.max(0, Math.min(100, Number.isFinite(numericValue) ? (numericValue <= 1 ? numericValue * 100 : numericValue) : 0));
  return (
    <SectionFrame section={section} icon={<Gauge />} className="runtime-section--confidence">
      <div className="runtime-confidence">
        <strong>{Math.round(percent)}%</strong>
        <div className="runtime-confidence__track" aria-label={`${Math.round(percent)} percent confidence`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>{firstText(data, ['explanation', 'summary'], 'Confidence in the public structured result.')}</p>
      </div>
    </SectionFrame>
  );
}

export function DecisionSection({ section, spec, pendingActionId, onAction }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const decisionId = firstText(data, ['decisionId', 'id'], '');
  return (
    <SectionFrame section={section} icon={<ShieldCheck />} className="runtime-section--decision">
      <div className="runtime-decision-copy">
        <span><Sparkles aria-hidden="true" /> Human checkpoint</span>
        <strong>{firstText(data, ['question', 'title'], section.title ?? 'A human decision is required')}</strong>
        <p>{firstText(data, ['explanation', 'summary', 'reason'], 'Review the evidence and choose one permitted action. The same run will resume after approval.')}</p>
      </div>
      <ActionButtons
        actions={spec.allowedActions}
        decisionId={decisionId || undefined}
        pendingActionId={pendingActionId}
        onAction={onAction}
      />
    </SectionFrame>
  );
}

export function ActionResultSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  return (
    <SectionFrame section={section} icon={<PackageCheck />} className="runtime-section--action-result">
      <div className="runtime-action-result">
        <span><Check aria-hidden="true" /></span>
        <div>
          <strong>{firstText(data, ['title', 'result', 'status'], 'Action recorded')}</strong>
          <p>{firstText(data, ['summary', 'message', 'explanation'], 'The run state and generated interface now reflect this action.')}</p>
        </div>
      </div>
      <KeyValueList data={data} omit={['title', 'result', 'status', 'summary', 'message', 'explanation']} />
    </SectionFrame>
  );
}

export function EventFeedSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  return (
    <SectionFrame section={section} icon={<Clock3 />} className="runtime-section--event-summary">
      <p className="runtime-alert-copy">{firstText(data, ['summary', 'latest', 'message'], 'The public event stream is available beside the active surface.')}</p>
      <KeyValueList data={data} omit={['summary', 'latest', 'message']} />
    </SectionFrame>
  );
}

export function GenericStepSection({ section }: RuntimeSectionComponentProps) {
  const data = record(section.data);
  const inputs = record(data.inputs);
  const outputs = record(data.outputs);
  const findings = Array.isArray(data.findings) ? data.findings : [];
  return (
    <SectionFrame section={section} icon={<Box />} className="runtime-section--generic">
      <div className="runtime-generic-status">
        <span>{firstText(data, ['owner', 'ownership'], 'Agent')}</span>
        <strong>{firstText(data, ['status', 'state'], 'Running')}</strong>
      </div>
      {Object.keys(inputs).length > 0 ? <div><h3>Validated inputs</h3><KeyValueList data={inputs} /></div> : null}
      {Object.keys(outputs).length > 0 ? <div><h3>Validated outputs</h3><KeyValueList data={outputs} /></div> : null}
      {findings.length > 0 ? (
        <ul className="runtime-generic-findings">
          {findings.map((item, index) => {
            const finding = record(item);
            return <li key={`${firstText(finding, ['id', 'title'], 'finding')}-${index}`}>{firstText(finding, ['title', 'summary'], toDisplayValue(item))}</li>;
          })}
        </ul>
      ) : null}
      {Object.keys(inputs).length === 0 && Object.keys(outputs).length === 0 && findings.length === 0 ? <KeyValueList data={data} /> : null}
    </SectionFrame>
  );
}

export function RuntimeActionFallback({
  spec,
  pendingActionId,
  onAction,
}: {
  spec: RuntimeUISpec;
  pendingActionId?: string | null;
  onAction: RuntimeSectionComponentProps['onAction'];
}) {
  return (
    <ActionButtons
      actions={spec.allowedActions}
      pendingActionId={pendingActionId}
      onAction={onAction}
    />
  );
}
