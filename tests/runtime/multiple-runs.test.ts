import { describe, expect, it } from 'vitest';

import { demoAgent } from '@/lib/agent/demo-agent';
import { FlowEngine } from '@/lib/runtime/flow-engine';
import { inferFlowMutation } from '@/lib/runtime/infer-step-semantics';
import { InMemoryRunStore } from '@/lib/runtime/run-store';
import type { FlowDefinition } from '@/lib/runtime/contracts';

const localTransitionFlow: FlowDefinition = {
  schemaVersion: '1.0',
  id: 'local-transition-proof',
  version: 1,
  name: 'Local transition proof',
  description: 'A minimal flow whose authoritative transition is stored on the step.',
  entryStepId: 'local-start',
  steps: [
    {
      schemaVersion: '1.0',
      id: 'local-start',
      title: 'Start locally',
      description: 'Start through a step-local transition.',
      kind: 'generic',
      capabilities: ['audit.view'],
      owner: 'system',
      transitions: [{ outcome: 'success', toStepId: 'local-finish' }],
    },
    {
      schemaVersion: '1.0',
      id: 'local-finish',
      title: 'Finish locally',
      description: 'Finish the local-transition proof.',
      kind: 'generic',
      capabilities: ['delivery.confirm'],
      owner: 'system',
      transitions: [{ outcome: 'success', toStepId: null }],
    },
  ],
  transitions: [],
  metadata: { purpose: 'test' },
};

describe('multiple run isolation', () => {
  it('mutates one operation without changing another', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const first = await store.createRun({ demoId: 'booking-preparation', label: 'Booking A' });
    const second = await store.createRun({ demoId: 'vessel-departed', label: 'Tracking B' });
    const secondBefore = store.getRun(second.snapshot.runId);
    expect(second.snapshot.latestUISpec?.sections.map((section) => section.type)).toEqual([
      'route-map',
      'container',
      'event-feed',
      'progress',
    ]);
    expect(
      second.snapshot.latestUISpec?.sections.find((section) => section.type === 'container')?.data.available,
    ).toBe(true);

    const mutation = await inferFlowMutation({
      instruction: 'Validate Bill of Lading against booking before confirming.',
      expectedFlowVersion: first.flow.version,
      provider: demoAgent,
    });
    await store.mutateFlow(first.snapshot.runId, mutation);

    const secondAfter = store.getRun(second.snapshot.runId);
    expect(secondAfter).toEqual(secondBefore);
    expect(store.listRuns()).toHaveLength(2);
    expect(new Set(store.listRuns().map((run) => run.runId)).size).toBe(2);
  });

  it('does not execute a mutation anchored in an unvisited branch', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const run = await store.createRun({ demoId: 'unexpected-transshipment' });
    const decisionBefore = run.snapshot.pendingDecision;
    const eventCountBefore = run.events.length;
    const mutation = await inferFlowMutation({
      instruction: 'Validate Bill of Lading against booking before confirming.',
      expectedFlowVersion: run.flow.version,
      provider: demoAgent,
    });

    const updated = await store.mutateFlow(run.snapshot.runId, mutation);
    const mutationEvents = updated.events.slice(eventCountBefore);

    expect(updated.snapshot.status).toBe('awaiting_human');
    expect(updated.snapshot.currentStepId).toBe(run.snapshot.currentStepId);
    expect(updated.snapshot.pendingDecision).toEqual(decisionBefore);
    expect(
      mutationEvents.some(
        (event) => event.type === 'step.started' && event.stepId === mutation.step.id,
      ),
    ).toBe(false);
    expect(mutationEvents.some((event) => event.type === 'ui.spec.emitted')).toBe(true);
  });

  it('rewires step-local transitions so a new run cannot bypass the inserted step', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const original = await store.createRun({ flow: localTransitionFlow, seed: {} });
    const insertedId = `step-${crypto.randomUUID()}`;
    const updated = await store.mutateFlow(original.snapshot.runId, {
      schemaVersion: '1.0',
      operation: 'insert-step',
      expectedFlowVersion: original.flow.version,
      step: {
        schemaVersion: '1.0',
        id: insertedId,
        title: 'Inspect the local handoff',
        description: 'A generic semantic step inserted into a local transition.',
        kind: 'generic',
        capabilities: ['audit.view'],
        owner: 'agent',
        transitions: [{ outcome: 'success', toStepId: 'local-finish' }],
      },
      position: { afterStepId: 'local-start', beforeStepId: 'local-finish' },
    });

    const replay = await store.createRun({ flow: updated.flow, seed: {} });
    const started = replay.events
      .filter((event) => event.type === 'step.started')
      .map((event) => event.stepId);

    expect(started).toEqual(['local-start', insertedId, 'local-finish']);
    expect(updated.flow.steps.find((step) => step.id === 'local-start')?.transitions).toContainEqual({
      outcome: 'success',
      toStepId: insertedId,
    });
  });

  it('marks downstream artifacts, connector states, and findings stale after mutation', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const created = await store.createRun({ demoId: 'booking-preparation' });
    const runId = created.snapshot.runId;
    await store.appendEvent(runId, {
      type: 'artifact.upserted',
      stepId: 'confirm-booking',
      payload: {
        artifact: {
          id: 'obsoleteConfirmation',
          kind: 'confirmation',
          value: { confirmed: true },
          truth: 'SIMULATED_IF_TODAY',
          revision: created.snapshot.revision + 1,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    await store.appendEvent(runId, {
      type: 'connector.call.completed',
      stepId: 'confirm-booking',
      payload: {
        connectorState: {
          connectorId: 'mock.yuno',
          status: 'available',
          truth: 'MOCK_CONNECTOR',
          updatedAt: new Date().toISOString(),
          data: { approved: true },
        },
      },
      truth: 'MOCK_CONNECTOR',
    });
    await store.appendEvent(runId, {
      type: 'finding.recorded',
      stepId: 'confirm-booking',
      payload: {
        finding: {
          id: 'obsolete-finding',
          kind: 'confirmation',
          severity: 'blocking',
          title: 'Old confirmation',
          summary: 'This result belongs to the invalidated downstream execution.',
          truth: 'SIMULATED_IF_TODAY',
        },
      },
    });
    await store.appendEvent(runId, {
      type: 'agent.summary.updated',
      stepId: 'confirm-booking',
      payload: {
        summary: {
          summary: 'The old downstream confirmation was accepted.',
          evidence: ['obsoleteConfirmation'],
          confidence: 0.99,
        },
      },
    });
    const beforeMutation = store.getRun(runId);
    const mutation = await inferFlowMutation({
      instruction: 'Validate Bill of Lading against booking before confirming.',
      expectedFlowVersion: beforeMutation.flow.version,
      provider: demoAgent,
    });

    const updated = await store.mutateFlow(runId, mutation);
    expect(updated.snapshot.artifacts.obsoleteConfirmation).toBeUndefined();
    expect(updated.snapshot.connectorStates['mock.yuno']).toMatchObject({ status: 'stale' });
    expect(updated.snapshot.connectorStates['mock.yuno']?.data).toMatchObject({ stale: true });
    expect(updated.snapshot.findings.find((finding) => finding.id === 'obsolete-finding')).toMatchObject({
      severity: 'info',
      details: { stale: true },
    });
    expect(
      updated.events.some(
        (event) =>
          event.type === 'agent.summary.updated' &&
          (event.payload.summary as { selectedAction?: string }).selectedAction ===
            'invalidate-downstream-results',
      ),
    ).toBe(true);
    expect(updated.snapshot.publicAgentSummary?.summary).not.toBe(
      'The old downstream confirmation was accepted.',
    );
    expect(
      updated.events.some(
        (event) =>
          event.type === 'flow.definition.updated' &&
          typeof event.payload.invalidationReason === 'string',
      ),
    ).toBe(true);
  });
});
