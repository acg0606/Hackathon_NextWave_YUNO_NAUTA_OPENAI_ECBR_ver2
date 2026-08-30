import { beforeEach, describe, expect, it } from 'vitest';

import { POST as createRun } from '@/app/api/runs/route';
import { scenarios } from '@/app/scenarios';
import { buildHistoricalReplaySeed } from '@/lib/demo/historical-replay';
import { runStore } from '@/lib/runtime/run-store';

describe('historical replay API integration', () => {
  beforeEach(() => {
    runStore.clearForTests();
  });

  it.each(scenarios)('creates the $id replay with canonical provenance', async (scenario) => {
    const response = await createRun(new Request('http://localhost/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        demoId: 'unexpected-transshipment',
        label: `Historical replay — ${scenario.shortName}`,
        idempotencyKey: crypto.randomUUID(),
        seed: buildHistoricalReplaySeed(scenario),
      }),
    }));

    expect(response.status).toBe(201);
    const body = await response.json() as {
      snapshot: {
        artifacts: {
          historicalEvidence?: {
            provenance?: { classification?: string; eventDate?: string };
          };
        };
      };
    };
    expect(body.snapshot.artifacts.historicalEvidence?.provenance).toMatchObject({
      classification: 'HISTORICAL_FACT',
      eventDate: scenario.eventStartDate,
    });
  });
});
