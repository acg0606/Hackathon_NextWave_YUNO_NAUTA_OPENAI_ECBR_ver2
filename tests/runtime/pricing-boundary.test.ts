import { describe, expect, it } from 'vitest';

import { calculateRouteQuote } from '@/lib/pricing/route-quote';

describe('RouteShift pricing boundary', () => {
  it('calculates a transparent simulated quote without attributing freight pricing to Yuno', () => {
    const quote = calculateRouteQuote({
      orderId: 'RS-NW26-014',
      productValueUsd: 72_000,
      originalMode: 'OCEAN_ROAD',
      proposedMode: 'AIR',
      distanceKm: 9_250,
      promiseDays: 30,
      operation: 'REQUOTE',
    });

    expect(quote.operation).toBe('REQUOTE');
    expect(quote.revisedTotal).toBeGreaterThan(quote.originalTotal);
    expect(quote.replacementTicketRequired).toBe(true);
    expect(quote.basis).toContain('RouteShift model');
    expect(JSON.stringify(quote)).not.toContain('Yuno');
  });
});
