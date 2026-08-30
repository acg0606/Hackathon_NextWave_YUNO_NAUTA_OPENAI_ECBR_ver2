export type RouteQuoteRequest = {
  orderId: string;
  productValueUsd: number;
  originalMode: 'AIR' | 'OCEAN' | 'OCEAN_ROAD' | 'RAIL_OCEAN';
  proposedMode: 'AIR' | 'OCEAN' | 'OCEAN_ROAD' | 'RAIL_OCEAN';
  distanceKm: number;
  promiseDays: number;
  operation?: 'QUOTE' | 'REQUOTE';
};

export type RouteQuote = {
  quoteId: string;
  currency: 'USD';
  originalTotal: number;
  revisedTotal: number;
  chargeDifference: number;
  refundRequired: boolean;
  refundAmount: number;
  replacementTicketRequired: boolean;
  operation: 'QUOTE' | 'REQUOTE';
  basis: string;
};

const MODE_RATE: Record<RouteQuoteRequest['originalMode'], number> = {
  AIR: 1.9,
  OCEAN: 0.42,
  OCEAN_ROAD: 0.58,
  RAIL_OCEAN: 0.66,
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function totalFor(request: RouteQuoteRequest, mode: RouteQuoteRequest['originalMode']) {
  const urgency = Math.max(0.9, 30 / Math.max(request.promiseDays, 1));
  return money(
    420
      + request.distanceKm * MODE_RATE[mode] * 0.62
      + request.productValueUsd * 0.006 * urgency,
  );
}

/**
 * Transparent, deterministic hackathon pricing model. It is intentionally not
 * attributed to Yuno: Yuno orchestrates payment state, while RouteShift owns
 * this simulated logistics quote.
 */
export function calculateRouteQuote(request: RouteQuoteRequest): RouteQuote {
  const originalTotal = totalFor(request, request.originalMode);
  const revisedTotal = totalFor(request, request.proposedMode);
  const chargeDifference = money(revisedTotal - originalTotal);
  const refundAmount = chargeDifference < 0 ? Math.abs(chargeDifference) : 0;

  return {
    quoteId: `route-quote-${request.orderId.toLowerCase().replace(/[^a-z0-9-]/g, '')}`,
    currency: 'USD',
    originalTotal,
    revisedTotal,
    chargeDifference,
    refundRequired: refundAmount > 0,
    refundAmount,
    replacementTicketRequired: request.originalMode !== request.proposedMode,
    operation: request.operation ?? 'QUOTE',
    basis:
      'Illustrative RouteShift model using distance, transport mode, product value, and delivery promise. No carrier tariff or payment provider produced this amount.',
  };
}
