import type { RunEvent } from './contracts';

export type RunEventCache = Record<string, RunEvent[]>;

export function appendRunEvent(
  cache: RunEventCache,
  event: RunEvent,
  limit = 120,
): RunEventCache {
  const current = cache[event.runId] ?? [];
  if (current.some((item) => item.eventId === event.eventId)) return cache;
  return {
    ...cache,
    [event.runId]: [...current, event].slice(-limit),
  };
}

export function eventsForRun(
  cache: RunEventCache,
  runId: string | null,
): RunEvent[] {
  return runId ? (cache[runId] ?? []) : [];
}

export function lastSequenceForRun(
  cache: RunEventCache,
  runId: string,
): number {
  return cache[runId]?.at(-1)?.sequence ?? 0;
}
