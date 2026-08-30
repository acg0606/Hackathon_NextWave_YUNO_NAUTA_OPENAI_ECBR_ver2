import { describe, expect, it } from 'vitest';

import { demoAgent } from '@/lib/agent/demo-agent';
import { FlowEngine } from '@/lib/runtime/flow-engine';
import { InMemoryRunStore, RunConflictError } from '@/lib/runtime/run-store';

describe('human-in-the-loop continuation', () => {
  it('keeps HOLD blocked until a release is recorded', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const initial = await store.createRun({ demoId: 'unexpected-transshipment' });
    const runId = initial.snapshot.runId;
    const firstDecision = initial.snapshot.pendingDecision!;

    const held = await store.submitAction(runId, {
      runId,
      decisionId: firstDecision.decisionId,
      actionId: 'hold',
      expectedRevision: initial.snapshot.revision,
      idempotencyKey: 'hold-once',
    });
    expect(held.snapshot.runId).toBe(runId);
    expect(held.snapshot.status).toBe('awaiting_human');
    expect(held.snapshot.pendingDecision?.title).toMatch(/hold/i);
    expect(held.events.some((event) => event.type === 'run.completed')).toBe(false);

    const resolution = held.snapshot.pendingDecision!;
    const released = await store.submitAction(runId, {
      runId,
      decisionId: resolution.decisionId,
      actionId: 'release',
      expectedRevision: held.snapshot.revision,
      idempotencyKey: 'release-once',
    });
    expect(released.snapshot.runId).toBe(runId);
    expect(released.snapshot.status).toBe('completed');
  });

  it('rejects a stale human revision', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const run = await store.createRun({ demoId: 'unexpected-transshipment' });
    await expect(
      store.submitAction(run.snapshot.runId, {
        runId: run.snapshot.runId,
        decisionId: run.snapshot.pendingDecision!.decisionId,
        actionId: 'reroute',
        expectedRevision: run.snapshot.revision - 1,
        idempotencyKey: 'stale-action',
      }),
    ).rejects.toBeInstanceOf(RunConflictError);
  });
});

