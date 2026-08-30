import type { JsonObject } from '@/lib/runtime/contracts';
import type { DemoFlowPhase } from '@/lib/flows/muebles-del-sur';

export type DemoRunPreset = {
  id: 'booking-preparation' | 'vessel-departed' | 'unexpected-transshipment';
  name: string;
  description: string;
  phase: DemoFlowPhase;
  seed: JsonObject;
};

const booking = {
  bookingNumber: 'BKG-NW26-014',
  containerNumber: 'MSCU0142026',
  portOfLoading: 'CNSHA',
  portOfDischarge: 'TRISK',
  grossWeightKg: 18_240,
  packageCount: 24,
};

const billOfLading = {
  billNumber: 'MAEU-NW26-014',
  bookingNumber: 'BKG-NW26-014',
  containerNumber: 'MSCU0142026',
  portOfLoading: 'CNSHA',
  portOfDischarge: 'TRMER',
  grossWeightKg: 19_050,
  packageCount: 24,
};

const commonSeed: JsonObject = {
  shipment: {
    orderId: 'RS-NW26-014',
    scenarioId: 'EVT-014',
    transportMode: 'OCEAN_ROAD',
    origin: 'Shanghai',
    destination: 'Gaziantep',
    disruption: 'NONE',
    route: ['Shanghai', 'Iskenderun', 'Gaziantep'],
    distanceKm: 9_250,
    promiseDays: 30,
  },
  order: {
    customer: 'Muebles del Sur',
    product: 'Industrial furniture components',
    productValueUsd: 72_000,
    packageCount: 24,
  },
  booking,
  billOfLading,
};

export const demoRunPresets: DemoRunPreset[] = [
  {
    id: 'booking-preparation',
    name: 'Run 1 — Booking preparation',
    description: 'Ari extracts the order, prices the service and prepares transport documents.',
    phase: 'BOOKING_PREPARATION',
    seed: structuredClone(commonSeed),
  },
  {
    id: 'vessel-departed',
    name: 'Run 2 — Vessel departed',
    description: 'The interface prioritizes route, container and ETA monitoring.',
    phase: 'VESSEL_DEPARTED',
    seed: {
      ...structuredClone(commonSeed),
      shipment: {
        ...(commonSeed.shipment as JsonObject),
        disruption: 'NONE',
        route: ['Shanghai', 'Singapore', 'Iskenderun', 'Gaziantep'],
      },
    },
  },
  {
    id: 'unexpected-transshipment',
    name: 'Run 3 — Unexpected transshipment',
    description: 'A nine-day delay turns the experience into an incident and decision workspace.',
    phase: 'UNEXPECTED_TRANSSHIPMENT',
    seed: {
      ...structuredClone(commonSeed),
      shipment: {
        ...(commonSeed.shipment as JsonObject),
        disruption: 'TRANSSHIPMENT',
        route: ['Shanghai', 'Singapore', 'Mersin', 'Gaziantep'],
        etaRevisionDays: 9,
      },
      historicalEvidence: {
        scenarioId: 'EVT-014',
        title: 'Operational impact of the 2023 earthquake in Türkiye',
        sourceTitle: 'Maersk operational update',
        sourceUrl:
          'https://www.maersk.com/news/articles/2023/02/06/operational-impact-of-earthquake-in-turkey',
        publicationDate: '2023-02-06',
        eventDate: '2023-02-06',
        retrievedAt: '2026-08-30T00:00:00.000Z',
        confidence: 0.98,
        classification: 'HISTORICAL_FACT',
      },
    },
  },
];

export function getDemoRunPreset(id: string | undefined): DemoRunPreset {
  return demoRunPresets.find((preset) => preset.id === id) ?? demoRunPresets[0];
}

export const trialByFireSeed = structuredClone(commonSeed);
