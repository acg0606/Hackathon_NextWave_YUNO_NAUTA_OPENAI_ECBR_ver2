import type { ConnectorEnvelope } from './types';

export type YunoQuoteRequest = {
  orderId: string;
  productValueUsd: number;
  originalMode: 'AIR' | 'OCEAN' | 'OCEAN_ROAD' | 'RAIL_OCEAN';
  proposedMode: 'AIR' | 'OCEAN' | 'OCEAN_ROAD' | 'RAIL_OCEAN';
  distanceKm: number;
  promiseDays: number;
  operation?: 'QUOTE' | 'REQUOTE' | 'REFUND' | 'PAYMENT';
};

export type YunoCommercialState = {
  quoteId: string;
  currency: 'USD';
  originalTotal: number;
  revisedTotal: number;
  chargeDifference: number;
  paymentState: 'APPROVED' | 'REQUIRES_CONFIRMATION' | 'REFUND_PENDING';
  refundRequired: boolean;
  refundAmount: number;
  replacementTicketRequired: boolean;
  authorizationReference: string;
  operation: 'QUOTE' | 'REQUOTE' | 'REFUND' | 'PAYMENT';
};

const MODE_RATE: Record<YunoQuoteRequest['originalMode'], number> = {
  AIR: 1.9,
  OCEAN: 0.42,
  OCEAN_ROAD: 0.58,
  RAIL_OCEAN: 0.66,
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function totalFor(request: YunoQuoteRequest, mode: YunoQuoteRequest['originalMode']) {
  const urgency = Math.max(0.9, 30 / Math.max(request.promiseDays, 1));
  return money(420 + request.distanceKm * MODE_RATE[mode] * 0.62 + request.productValueUsd * 0.006 * urgency);
}

export async function quoteWithYunoMock(
  request: YunoQuoteRequest,
): Promise<ConnectorEnvelope<YunoCommercialState>> {
  const originalTotal = totalFor(request, request.originalMode);
  const revisedTotal = totalFor(request, request.proposedMode);
  const chargeDifference = money(revisedTotal - originalTotal);
  const operation = request.operation ?? 'QUOTE';
  const refundRequired = operation === 'REFUND' || chargeDifference < 0;
  const refundAmount = refundRequired
    ? operation === 'REFUND'
      ? money(Math.max(Math.abs(chargeDifference), originalTotal * 0.1))
      : Math.abs(chargeDifference)
    : 0;
  const now = new Date().toISOString();

  return {
    connector: 'YUNO',
    classification: 'MOCK_CONNECTOR',
    status: 'available',
    fetchedAt: now,
    data: {
      quoteId: `yuno-mock-${request.orderId.toLowerCase()}`,
      currency: 'USD',
      originalTotal,
      revisedTotal,
      chargeDifference,
      paymentState: operation === 'PAYMENT'
        ? 'APPROVED'
        : refundRequired
        ? 'REFUND_PENDING'
        : chargeDifference > 0
          ? 'REQUIRES_CONFIRMATION'
          : 'APPROVED',
      refundRequired,
      refundAmount,
      replacementTicketRequired: request.originalMode !== request.proposedMode,
      authorizationReference: `MOCK-AUTH-${request.orderId.replace(/[^A-Z0-9]/gi, '').slice(-10).toUpperCase()}`,
      operation,
    },
    publicNote:
      'Deterministic Yuno-compatible commercial simulation. No payment, charge, reversal, or external API call occurred.',
  };
}
