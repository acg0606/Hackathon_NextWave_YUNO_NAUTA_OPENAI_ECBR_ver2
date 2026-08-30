import type { Scenario } from '@/app/scenarios';
import type { JsonObject } from '@/lib/runtime/contracts';

/** Builds the exact deterministic seed used by the historical replay UI. */
export function buildHistoricalReplaySeed(scenario: Scenario): JsonObject {
  return {
    customer: {
      name: 'Muebles del Sur',
      contact: 'Lucía Herrera',
    },
    shipment: {
      orderId: `RS-NW26-${scenario.id.replace('EVT-', '')}`,
      scenarioId: scenario.id,
      transportMode: scenario.modeBefore,
      origin: scenario.origin,
      destination: scenario.destination,
      disruption: scenario.shortName,
      route: scenario.routeAfter,
      promise: scenario.promise,
      product: scenario.product,
    },
    historicalEvidence: {
      scenarioId: scenario.id,
      title: scenario.shortName,
      headline: scenario.headline,
      summary: scenario.historicalImpact,
      eventDate: scenario.eventStartDate,
      sourceTitle: scenario.sourceLabel,
      sourceUrl: scenario.sourceUrl,
      classification: 'HISTORICAL_FACT',
    },
    currentContext: {
      classification: 'UNKNOWN',
      status: 'Not fetched for this deterministic replay',
    },
    simulatedResponse: {
      route: scenario.routeAfter,
      recommendation: scenario.recommendation,
      etaDelta: scenario.etaDelta,
      costDelta: scenario.costDelta,
      documentChange: scenario.documentChange,
      classification: 'SIMULATED_IF_TODAY',
    },
  };
}
