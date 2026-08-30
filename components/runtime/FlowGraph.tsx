'use client';

import { Check, Pause, Sparkles } from 'lucide-react';
import type { FlowDefinition, RunSnapshot, StepDefinition } from '@/lib/runtime/contracts';

export type FlowGraphProps = {
  flow: FlowDefinition | null;
  snapshot: RunSnapshot;
};

function inferredSteps(snapshot: RunSnapshot): StepDefinition[] {
  const ids = Array.from(new Set([
    ...snapshot.completedStepIds,
    ...snapshot.skippedStepIds,
    ...(snapshot.currentStepId ? [snapshot.currentStepId] : []),
  ]));
  return ids.map((id) => ({
    schemaVersion: '1.0',
    id,
    title: id.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: 'Runtime-discovered step',
    kind: 'generic',
    capabilities: [],
    owner: 'system',
  }));
}

function stepStatus(step: StepDefinition, snapshot: RunSnapshot) {
  if (snapshot.currentStepId === step.id) return snapshot.status === 'awaiting_human' ? 'waiting' : 'current';
  if (snapshot.skippedStepIds.includes(step.id)) return 'skipped';
  if (snapshot.completedStepIds.includes(step.id)) return 'complete';
  return 'queued';
}

export function FlowGraph({ flow, snapshot }: FlowGraphProps) {
  const steps = flow?.steps ?? inferredSteps(snapshot);
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === snapshot.currentStepId));
  const denominator = Math.max(1, steps.length - 1);
  const progress = `${Math.min(100, (currentIndex / denominator) * 100)}%`;

  return (
    <nav className="runtime-flow-graph" aria-label="Run flow">
      <div className="runtime-flow-graph__label">
        <Sparkles aria-hidden="true" />
        <span>Flow v{snapshot.flowVersion}</span>
      </div>
      <div className="runtime-flow-graph__scroll">
        <ol className="runtime-flow-graph__track" style={{ '--flow-progress': progress } as React.CSSProperties}>
          {steps.map((step, index) => {
            const status = stepStatus(step, snapshot);
            return (
              <li
                aria-current={status === 'current' || status === 'waiting' ? 'step' : undefined}
                className={`is-${status}`}
                key={step.id}
              >
                <span className="runtime-flow-graph__node">
                  {status === 'complete' ? <Check aria-hidden="true" /> : status === 'waiting' ? <Pause aria-hidden="true" /> : index + 1}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{status === 'waiting' ? 'Human decision' : status}</small>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="runtime-flow-graph__status">
        <span>{snapshot.status.replace('_', ' ')}</span>
        <strong>r{snapshot.revision}</strong>
      </div>
    </nav>
  );
}

export default FlowGraph;
