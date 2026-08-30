import { describe, expect, it } from 'vitest';

import { initialRunSnapshot, reduceRunEvent, replayRunEvents } from '@/lib/runtime/reducer';
import { fixedNow, makeEvent, makeFlow } from '@/tests/fixtures/runtime-fixtures';

describe('run reducer', () => {
  it('replays ordered events deterministically', () => {
    const flow = makeFlow();
    const events = [
      makeEvent(1, 'run.created', {
        flowId: flow.id,
        flowVersion: flow.version,
        createdAt: fixedNow,
      }),
      makeEvent(2, 'flow.loaded', { flowId: flow.id, flowVersion: flow.version }),
      makeEvent(3, 'step.started', {}, { stepId: 'prepare-booking' }),
      makeEvent(4, 'step.completed', {}, { stepId: 'prepare-booking' }),
      makeEvent(5, 'run.completed'),
    ];

    const first = replayRunEvents(events);
    const second = replayRunEvents(events);
    expect(second).toEqual(first);
    expect(first.status).toBe('completed');
    expect(first.completedStepIds).toEqual(['prepare-booking']);
  });

  it('ignores an already processed event ID without duplicating state', () => {
    const flow = makeFlow();
    const initial = initialRunSnapshot('run-test-001', flow, fixedNow);
    const created = makeEvent(1, 'run.created', {
      flowId: flow.id,
      flowVersion: flow.version,
      createdAt: fixedNow,
    });
    const once = reduceRunEvent(initial, created);
    expect(reduceRunEvent(once, created)).toEqual(once);
  });

  it('rejects gaps and backwards revisions', () => {
    const flow = makeFlow();
    const initial = initialRunSnapshot('run-test-001', flow, fixedNow);
    expect(() => reduceRunEvent(initial, makeEvent(2, 'flow.loaded'))).toThrow(/sequence gap/i);

    const created = reduceRunEvent(
      initial,
      makeEvent(1, 'run.created', { flowId: flow.id, flowVersion: flow.version }),
    );
    expect(() =>
      reduceRunEvent(
        created,
        makeEvent(2, 'flow.loaded', {}, { revision: 0 }),
      ),
    ).toThrow(/backwards/i);
  });

  it('records a human action idempotency key once', () => {
    const flow = makeFlow();
    const snapshot = {
      ...initialRunSnapshot('run-test-001', flow, fixedNow),
      revision: 1,
      lastSequence: 1,
      status: 'awaiting_human' as const,
      processedEventIds: ['event-1'],
      pendingDecision: {
        decisionId: 'decision-1',
        title: 'Resolve the document mismatch',
        explanation: 'A corrected document is required.',
        actions: [
          {
            actionId: 'request-corrected-document',
            label: 'Request corrected B/L',
            intent: 'request-corrected-document' as const,
          },
        ],
        expectedRevision: 1,
        requestedAt: fixedNow,
      },
    };
    const next = reduceRunEvent(
      snapshot,
      makeEvent(2, 'human.action.received', {
        idempotencyKey: 'idem-1',
        actionId: 'request-corrected-document',
      }),
    );
    expect(next.processedIdempotencyKeys).toEqual(['idem-1']);
    expect(next.pendingDecision).toBeNull();
  });
});

