'use client';

import { Bot, Check, Pause, Route, Sparkles } from 'lucide-react';
import type { FlowDefinition, RunSnapshot } from '@/lib/runtime/contracts';
import {
  buildDispatchJourney,
  journeyStatusLabel,
  ownerLabel,
  trajectoryShiftTitle,
} from '@/lib/runtime/dispatch-journey';

export type FlowGraphProps = {
  flow: FlowDefinition | null;
  snapshot: RunSnapshot;
};

function routeLine(stops: string[]): string {
  return stops.length > 0 ? stops.join(' → ') : 'Corridor not published';
}

export function FlowGraph({ flow, snapshot }: FlowGraphProps) {
  const journey = buildDispatchJourney(flow, snapshot);
  const progress = `${journey.progressPercent}%`;
  const shift = journey.trajectoryShift;

  return (
    <nav
      aria-label="Dispatch journey"
      className={`runtime-flow-graph${shift ? ' is-shifted' : ''}`}
    >
      <div className="runtime-flow-graph__label">
        <Sparkles aria-hidden="true" />
        <span>Dispatch journey</span>
        <small>Flow v{snapshot.flowVersion}</small>
      </div>
      <div className="runtime-flow-graph__body">
        {shift ? (
          <aside
            aria-live="polite"
            className={`runtime-flow-graph__shift is-${shift.kind}`}
          >
            <span className="runtime-flow-graph__agent">
              <Bot aria-hidden="true" />
              {shift.agentLabel}
            </span>
            <div>
              <strong>{trajectoryShiftTitle(shift.kind)}</strong>
              <p>{shift.summary}</p>
            </div>
            <ol className="runtime-flow-graph__trajectory" aria-label="Dispatch trajectory change">
              <li>
                <span>Planned</span>
                <strong>{routeLine(shift.from)}</strong>
              </li>
              <li>
                <Route aria-hidden="true" />
              </li>
              <li>
                <span>Now</span>
                <strong>{routeLine(shift.to)}</strong>
              </li>
            </ol>
          </aside>
        ) : null}
        <div className="runtime-flow-graph__scroll">
          <ol className="runtime-flow-graph__track" style={{ '--flow-progress': progress } as React.CSSProperties}>
            {journey.steps.map((step, index) => (
              <li
                aria-current={step.status === 'current' || step.status === 'waiting' ? 'step' : undefined}
                className={`is-${step.status}${step.agentHighlighted ? ' is-agent' : ''}`}
                data-owner={step.owner}
                key={step.stepId}
              >
                <span className="runtime-flow-graph__node">
                  {step.status === 'complete' ? <Check aria-hidden="true" /> : step.status === 'waiting' ? <Pause aria-hidden="true" /> : step.agentHighlighted ? <Bot aria-hidden="true" /> : index + 1}
                </span>
                <div>
                  <em>{ownerLabel(step.owner)}</em>
                  <strong>{step.title}</strong>
                  <small>{step.agentHighlighted ? `${journeyStatusLabel(step.status)} · agent on this change` : journeyStatusLabel(step.status)}</small>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="runtime-flow-graph__status">
        <span>{snapshot.status.replace('_', ' ')}</span>
        <strong>r{snapshot.revision}</strong>
      </div>
    </nav>
  );
}

export default FlowGraph;
