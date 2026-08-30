const baseUrl = process.env.ROUTESHIFT_BASE_URL ?? 'http://127.0.0.1:4388';

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return body;
}

function publicConnectorState(snapshot, connectorId) {
  const state = snapshot.connectorStates?.[connectorId];
  if (!state) return { connectorId, observed: false };
  return {
    connectorId,
    observed: true,
    status: state.status,
    truth: state.truth,
    updatedAt: state.updatedAt,
    observationCount:
      typeof state.data?.observationCount === 'number'
        ? state.data.observationCount
        : null,
  };
}

async function createTrafficRun(mode) {
  const isAir = mode === 'AIR';
  return json('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      demoId: 'vessel-departed',
      label: `Connector verification — ${mode}`,
      seed: {
        shipment: {
          orderId: `RS-VERIFY-${mode}`,
          scenarioId: 'LIVE_CONNECTOR_CHECK',
          transportMode: mode,
          origin: 'Shanghai',
          destination: isAir ? 'Atlanta' : 'Gaziantep',
          destinationCoordinates: isAir ? [-84.4277, 33.6407] : [37.3781, 37.0662],
          disruption: 'NONE',
          route: isAir ? ['Shanghai', 'Atlanta'] : ['Shanghai', 'Mersin', 'Gaziantep'],
          distanceKm: isAir ? 12_000 : 9_250,
          promiseDays: isAir ? 14 : 30,
        },
        order: {
          customer: 'Muebles del Sur',
          product: 'Connector verification fixture',
          productValueUsd: 1_000,
          packageCount: 1,
        },
      },
    }),
  });
}

const status = await json('/api/integrations/status');
const air = await createTrafficRun('AIR');
const ocean = await createTrafficRun('OCEAN_ROAD');

const output = {
  checkedAt: new Date().toISOString(),
  server: baseUrl,
  secretsExposed: status.secretsExposed,
  capabilities: status.services.map((service) => ({
    id: service.id,
    configured: service.configured,
    available: service.available,
    mode: service.mode,
    fallbackActive: service.fallbackActive,
  })),
  observations: [
    publicConnectorState(air.snapshot, 'ADSB_LOL'),
    publicConnectorState(ocean.snapshot, 'AISSTREAM'),
  ],
};

console.log(JSON.stringify(output, null, 2));
