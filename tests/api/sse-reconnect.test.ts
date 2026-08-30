import { beforeEach, describe, expect, it } from 'vitest';

import { GET as streamEvents } from '@/app/api/runs/[runId]/events/route';
import { runStore } from '@/lib/runtime/run-store';

function context(runId: string) {
  return { params: Promise.resolve({ runId }) };
}

async function firstSseChunk(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE response did not expose a readable stream.');
  let decoded = '';
  while (!decoded.includes('event: run-event')) {
    const { done, value } = await reader.read();
    if (done) break;
    decoded += new TextDecoder().decode(value);
  }
  await reader.cancel();
  return decoded;
}

describe('run event stream', () => {
  beforeEach(() => {
    runStore.clearForTests();
  });

  it('replays only events after Last-Event-ID', async () => {
    const run = await runStore.createRun({ demoId: 'booking-preparation' });
    const resumeAfter = run.events[2].sequence;
    const expected = run.events.find((event) => event.sequence === resumeAfter + 1);

    const response = await streamEvents(
      new Request(`http://localhost/api/runs/${run.snapshot.runId}/events`, {
        headers: { 'last-event-id': String(resumeAfter) },
      }),
      context(run.snapshot.runId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const chunk = await firstSseChunk(response);
    expect(chunk).toContain(`id: ${resumeAfter + 1}`);
    expect(chunk).toContain(`"eventId":"${expected?.eventId}"`);
  });

  it('uses the after query parameter when no Last-Event-ID header exists', async () => {
    const run = await runStore.createRun({ demoId: 'vessel-departed' });
    const resumeAfter = run.events[1].sequence;

    const response = await streamEvents(
      new Request(
        `http://localhost/api/runs/${run.snapshot.runId}/events?after=${resumeAfter}`,
      ),
      context(run.snapshot.runId),
    );

    const chunk = await firstSseChunk(response);
    expect(chunk).toContain(`id: ${resumeAfter + 1}`);
    expect(chunk).not.toContain(`id: ${resumeAfter}\n`);
  });

  it('flushes an immediate comment when there are no replay events', async () => {
    const run = await runStore.createRun({ demoId: 'booking-preparation' });
    const response = await streamEvents(
      new Request(
        `http://localhost/api/runs/${run.snapshot.runId}/events?after=${run.snapshot.lastSequence}`,
      ),
      context(run.snapshot.runId),
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('SSE response did not expose a readable stream.');

    const first = await reader.read();
    await reader.cancel();
    expect(new TextDecoder().decode(first.value)).toContain(': connected');
  });

  it('streams a newly committed memory event after the initial replay', async () => {
    const run = await runStore.createRun({ demoId: 'unexpected-transshipment' });
    const response = await streamEvents(
      new Request(
        `http://localhost/api/runs/${run.snapshot.runId}/events?after=${run.snapshot.lastSequence}`,
      ),
      context(run.snapshot.runId),
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('SSE response did not expose a readable stream.');

    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(': connected');

    const pending = run.snapshot.pendingDecision;
    if (!pending) throw new Error('The disruption run did not expose its human decision.');
    const action = pending.actions[0];
    if (!action) throw new Error('The disruption decision did not expose a permitted action.');
    const nextSequence = run.snapshot.lastSequence + 1;
    const readNext = reader.read();
    await runStore.submitAction(run.snapshot.runId, {
      runId: run.snapshot.runId,
      decisionId: pending.decisionId,
      actionId: action.actionId,
      expectedRevision: run.snapshot.revision,
      idempotencyKey: `sse-live-${crypto.randomUUID()}`,
    });

    const next = await readNext;
    await reader.cancel();
    const decoded = new TextDecoder().decode(next.value);
    expect(decoded).toContain(`id: ${nextSequence}`);
    expect(decoded).toContain('human.action.received');
  });
});
