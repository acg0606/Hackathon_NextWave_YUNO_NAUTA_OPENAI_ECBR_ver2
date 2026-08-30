import type { ConnectorEnvelope } from './types';

export type NautaTrackingRequest = {
  orderId: string;
  containerNumber: string;
  origin: string;
  destination: string;
  route: string[];
  disruption?: 'NONE' | 'TRANSSHIPMENT' | 'ROUTE_INTERRUPTION' | 'VISIBILITY_DEGRADED';
  operation?: 'TRACK' | 'REROUTE' | 'RELEASE' | 'MILESTONES';
};

export type NautaTrackingState = {
  shipmentId: string;
  containerNumber: string;
  status:
    | 'BOOKED'
    | 'VESSEL_DEPARTED'
    | 'UNEXPECTED_TRANSSHIPMENT'
    | 'ROUTE_INTERRUPTED'
    | 'VISIBILITY_DEGRADED'
    | 'REROUTED'
    | 'RELEASED';
  estimatedPosition: { longitude: number; latitude: number };
  route: string[];
  etaRevisionDays: number;
  confidence: number;
  resolution: 'MONITORING' | 'REROUTED' | 'RELEASED';
  operation: 'TRACK' | 'REROUTE' | 'RELEASE' | 'MILESTONES';
  milestones: Array<{
    code: string;
    label: string;
    state: 'completed' | 'current' | 'pending';
  }>;
};

export async function trackWithNautaMock(
  request: NautaTrackingRequest,
): Promise<ConnectorEnvelope<NautaTrackingState>> {
  const disruption = request.disruption ?? 'NONE';
  const operation = request.operation ?? 'TRACK';
  const now = new Date().toISOString();
  const status: NautaTrackingState['status'] =
    operation === 'REROUTE'
      ? 'REROUTED'
      : operation === 'RELEASE'
        ? 'RELEASED'
        : disruption === 'TRANSSHIPMENT'
      ? 'UNEXPECTED_TRANSSHIPMENT'
      : disruption === 'ROUTE_INTERRUPTION'
        ? 'ROUTE_INTERRUPTED'
        : disruption === 'VISIBILITY_DEGRADED'
          ? 'VISIBILITY_DEGRADED'
          : 'VESSEL_DEPARTED';

  return {
    connector: 'NAUTA',
    classification: 'MOCK_CONNECTOR',
    status: 'available',
    fetchedAt: now,
    data: {
      shipmentId: `nauta-mock-${request.orderId.toLowerCase()}`,
      containerNumber: request.containerNumber,
      status,
      estimatedPosition: { longitude: 77.35, latitude: 6.82 },
      route: request.route.slice(0, 12),
      etaRevisionDays:
        operation === 'REROUTE'
          ? 4
          : operation === 'RELEASE'
            ? 0
            : disruption === 'TRANSSHIPMENT'
              ? 9
              : disruption === 'NONE'
                ? 0
                : 4,
      confidence: disruption === 'VISIBILITY_DEGRADED' ? 0.54 : 0.91,
      resolution:
        operation === 'REROUTE'
          ? 'REROUTED'
          : operation === 'RELEASE'
            ? 'RELEASED'
            : 'MONITORING',
      operation,
      milestones: [
        { code: 'BOOKED', label: 'Booking confirmed', state: 'completed' },
        { code: 'DEPARTED', label: `Departed ${request.origin}`, state: 'completed' },
        {
          code: disruption === 'TRANSSHIPMENT' ? 'TRANSSHIPMENT' : 'IN_TRANSIT',
          label:
            operation === 'REROUTE'
              ? 'Reroute accepted and published'
              : operation === 'RELEASE'
                ? 'Shipment released from hold'
                : disruption === 'TRANSSHIPMENT'
              ? 'Unexpected transshipment detected'
              : 'Shipment in transit',
          state: 'current',
        },
        { code: 'ARRIVAL', label: `Arrival at ${request.destination}`, state: 'pending' },
      ],
    },
    publicNote:
      'Deterministic Nauta-compatible visibility simulation. No live Nauta shipment or external API call was used.',
  };
}
