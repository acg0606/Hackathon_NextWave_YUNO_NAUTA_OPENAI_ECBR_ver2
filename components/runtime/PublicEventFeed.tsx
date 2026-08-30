'use client';

import { Activity, ChevronDown, Radio, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { RunEvent } from '@/lib/runtime/contracts';
import { TruthBadge } from './runtime-primitives';

export type RuntimeConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export type PublicEventFeedProps = {
  events: RunEvent[];
  connection: RuntimeConnectionState;
};

function eventLabel(type: RunEvent['type']) {
  return type
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function payloadSummary(event: RunEvent) {
  const candidates = ['summary', 'message', 'title', 'result', 'actionLabel', 'reason'];
  for (const key of candidates) {
    const value = event.payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  if (event.stepId) return `Step ${event.stepId}`;
  return `Revision ${event.revision}`;
}

function timeLabel(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function PublicEventFeed({ events, connection }: PublicEventFeedProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleEvents = (expanded ? events : events.slice(-5)).slice().reverse();

  return (
    <aside className={`runtime-event-feed is-${connection}${expanded ? ' is-expanded' : ''}`} aria-labelledby="event-feed-title">
      <button
        aria-expanded={expanded}
        className="runtime-event-feed__toggle"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="runtime-event-feed__connection"><Radio aria-hidden="true" /> {connection}</span>
        <span>
          <strong id="event-feed-title">Public event stream</strong>
          <small>{events.length} validated {events.length === 1 ? 'event' : 'events'}</small>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>

      <ol className="runtime-event-feed__list" role="log" aria-live="polite" aria-relevant="additions">
        {visibleEvents.length > 0 ? visibleEvents.map((event) => (
          <li className={event.type === 'human.action.received' ? 'is-human' : ''} key={event.eventId}>
            <span className="runtime-event-feed__sequence">{String(event.sequence).padStart(2, '0')}</span>
            <div>
              <strong>{eventLabel(event.type)}</strong>
              <p>{payloadSummary(event)}</p>
              <small>{timeLabel(event.timestamp)} · revision {event.revision}</small>
            </div>
            <TruthBadge truth={event.truth} />
          </li>
        )) : (
          <li className="runtime-event-feed__empty">
            <Activity aria-hidden="true" />
            <div><strong>Waiting for the first event</strong><p>The browser will render only validated public runtime events.</p></div>
          </li>
        )}
      </ol>

      <footer>
        <ShieldCheck aria-hidden="true" />
        Public summaries only. Private reasoning is never streamed.
      </footer>
    </aside>
  );
}

export default PublicEventFeed;
