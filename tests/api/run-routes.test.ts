import { beforeEach, describe, expect, it } from 'vitest';

import { POST as submitAction } from '@/app/api/runs/[runId]/actions/route';
import { POST as mutateFlow } from '@/app/api/runs/[runId]/flow/route';
import { GET as getRun } from '@/app/api/runs/[runId]/route';
import { POST as createRun } from '@/app/api/runs/route';
import { runStore } from '@/lib/runtime/run-store';

type RunApiBody = {
  runId: string;
  revision: number;
  flowVersion: number;
  eventsUrl: string;
  persistence?: string;
  climax?: string;
  snapshot: {
    runId: string;
    status: string;
    pendingDecision: null | {
      decisionId: string;
    };
    processedIdempotencyKeys: string[];
  };
};

async function readRunBody(response: Response) {
  return (await response.json()) as RunApiBody;
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(runId: string) {
  return { params: Promise.resolve({ runId }) };
}

describe('run API routes', () => {
  beforeEach(() => {
    runStore.clearForTests();
  });

  it('creates and materializes a validated run', async () => {
    const createdResponse = await createRun(
      jsonRequest('http://localhost/api/runs', { demoId: 'booking-preparation' }),
    );

    expect(createdResponse.status).toBe(201);
    const created = await readRunBody(createdResponse);
    expect(created.runId).toMatch(/^run-/);
    expect(created.eventsUrl).toBe(`/api/runs/${created.runId}/events`);
    expect(created.snapshot.runId).toBe(created.runId);

    const materializedResponse = await getRun(
      new Request(`http://localhost/api/runs/${created.runId}`),
      context(created.runId),
    );
    expect(materializedResponse.status).toBe(200);
    const materialized = await readRunBody(materializedResponse);
    expect(materialized.persistence).toBe('IN_MEMORY_NON_DURABLE');
    expect(materialized.snapshot).toEqual(created.snapshot);
  });

  it('rejects an oversized body even without a Content-Length header', async () => {
    const request = new Request('http://localhost/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'x'.repeat(66_000) }),
    });
    request.headers.delete('content-length');

    const response = await createRun(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: 'The request body is too large.' },
    });
  });

  it('rejects stale decisions, resumes the same run, and deduplicates retries', async () => {
    const createdResponse = await createRun(
      jsonRequest('http://localhost/api/runs', { demoId: 'booking-preparation' }),
    );
    const created = await readRunBody(createdResponse);

    const mutatedResponse = await mutateFlow(
      jsonRequest(`http://localhost/api/runs/${created.runId}/flow`, {
        instruction: 'Validate Bill of Lading against booking before confirming.',
        expectedFlowVersion: created.flowVersion,
      }),
      context(created.runId),
    );
    expect(mutatedResponse.status).toBe(200);
    const mutated = await readRunBody(mutatedResponse);
    expect(mutated.climax).toBe('FLOW CHANGED → ARI UNDERSTOOD → UI RECOMPOSED');
    expect(mutated.snapshot.status).toBe('awaiting_human');

    const decision = mutated.snapshot.pendingDecision;
    if (!decision) throw new Error('The validation run did not expose its human decision.');
    const idempotencyKey = `test-${crypto.randomUUID()}`;
    const staleResponse = await submitAction(
      jsonRequest(`http://localhost/api/runs/${created.runId}/actions`, {
        decisionId: decision.decisionId,
        actionId: 'request-corrected-document',
        expectedRevision: mutated.revision - 1,
        idempotencyKey,
      }),
      context(created.runId),
    );
    expect(staleResponse.status).toBe(409);

    const actionBody = {
      decisionId: decision.decisionId,
      actionId: 'request-corrected-document',
      expectedRevision: mutated.revision,
      idempotencyKey,
    };
    const acceptedResponse = await submitAction(
      jsonRequest(`http://localhost/api/runs/${created.runId}/actions`, actionBody),
      context(created.runId),
    );
    expect(acceptedResponse.status).toBe(202);
    const accepted = await readRunBody(acceptedResponse);
    expect(accepted.runId).toBe(created.runId);
    expect(accepted.snapshot.runId).toBe(created.runId);

    const actionEventCount = accepted.snapshot.processedIdempotencyKeys.length;
    const duplicateResponse = await submitAction(
      jsonRequest(`http://localhost/api/runs/${created.runId}/actions`, actionBody),
      context(created.runId),
    );
    expect(duplicateResponse.status).toBe(202);
    const duplicate = await readRunBody(duplicateResponse);
    expect(duplicate.snapshot.processedIdempotencyKeys).toHaveLength(actionEventCount);
    expect(duplicate.revision).toBe(accepted.revision);
  });
});
