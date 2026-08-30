import { describe, expect, it } from 'vitest';

import {
  appendRunEvent,
  eventsForRun,
  lastSequenceForRun,
  type RunEventCache,
} from '@/lib/runtime/client-event-cache';
import type { RunEvent } from '@/lib/runtime/contracts';
import { fixedNow } from '@/tests/fixtures/runtime-fixtures';

function event(runId: string, sequence: number): RunEvent {
  return {
    eventId: `${runId}-event-${sequence}`,
    runId,
    sequence,
    revision: sequence,
    timestamp: fixedNow,
    type: 'ui.spec.emitted',
    payload: { sequence },
    truth: 'SIMULATED_IF_TODAY',
  };
}

describe('client run event cache', () => {
  it('keeps streamed events isolated when the operator switches runs', () => {
    let cache: RunEventCache = {};
    cache = appendRunEvent(cache, event('run-a', 1));
    cache = appendRunEvent(cache, event('run-a', 2));
    cache = appendRunEvent(cache, event('run-b', 1));

    expect(eventsForRun(cache, 'run-a').map((item) => item.sequence)).toEqual([1, 2]);
    expect(eventsForRun(cache, 'run-b').map((item) => item.sequence)).toEqual([1]);
    expect(lastSequenceForRun(cache, 'run-a')).toBe(2);
    expect(lastSequenceForRun(cache, 'run-b')).toBe(1);
  });

  it('deduplicates replayed event IDs within one run', () => {
    const first = event('run-a', 1);
    const cache = appendRunEvent(appendRunEvent({}, first), first);
    expect(eventsForRun(cache, 'run-a')).toEqual([first]);
  });
});
