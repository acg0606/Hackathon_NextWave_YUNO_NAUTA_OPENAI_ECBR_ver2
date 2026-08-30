import { inspectYunoSandboxEnvironment } from '@/lib/connectors/yuno-sandbox';
import { getOpenAIProviderHealth } from '@/lib/agent/provider-health';
import type { TruthClassification } from '@/lib/runtime/contracts';

type IntegrationStatus = {
  id: 'OPENAI' | 'YUNO' | 'AISSTREAM' | 'ADSB_LOL' | 'NASA_EONET' | 'NAUTA';
  label: string;
  configured: boolean;
  available: boolean | null;
  mode: string;
  fallbackActive: boolean;
  lastSuccessAt: string | null;
  latencyMs: number | null;
  truth: TruthClassification;
  publicNote: string;
};

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  const yuno = inspectYunoSandboxEnvironment();
  const openAIHealth = getOpenAIProviderHealth();
  const openAIConfigured = configured('OPENAI_API_KEY');
  const aisConfigured = configured('AISSTREAM_API_KEY');
  const services: IntegrationStatus[] = [
    {
      id: 'OPENAI',
      label: 'OpenAI structured agent',
      configured: openAIConfigured,
      available: openAIConfigured ? openAIHealth?.available ?? null : false,
      mode: openAIHealth?.available
        ? 'live-verified'
        : openAIConfigured
          ? openAIHealth?.failureReason ?? 'server-configured'
          : 'deterministic-fallback',
      fallbackActive: openAIHealth?.fallbackActive ?? !openAIConfigured,
      lastSuccessAt: openAIHealth?.lastSuccessAt ?? null,
      latencyMs: openAIHealth?.latencyMs ?? null,
      truth: 'SIMULATED_IF_TODAY',
      publicNote: openAIHealth?.available
        ? 'A server-side Responses API call returned schema-validated semantic output. No prompt, response payload, or credential is exposed.'
        : 'The runtime validates structured semantic output and falls back deterministically. Configuration does not itself prove a successful provider call.',
    },
    {
      id: 'YUNO',
      label: 'Yuno payment orchestration',
      configured: yuno.configured,
      available: null,
      mode: yuno.configured ? 'external-sandbox' : 'mock-fallback',
      fallbackActive: !yuno.configured,
      lastSuccessAt: null,
      latencyMs: null,
      truth: yuno.configured ? 'EXTERNAL_SANDBOX' : 'MOCK_CONNECTOR',
      publicNote: yuno.configured
        ? 'Yuno Sandbox credentials are server-configured. Test data only; no production funds or accounting.'
        : 'Yuno Sandbox is not configured in this process; payment effects remain deterministic mocks.',
    },
    {
      id: 'AISSTREAM',
      label: 'AISStream vessel traffic',
      configured: aisConfigured,
      available: null,
      mode: aisConfigured ? 'server-stream-configured' : 'unavailable',
      fallbackActive: !aisConfigured,
      lastSuccessAt: null,
      latencyMs: null,
      truth: 'UNKNOWN',
      publicNote: aisConfigured
        ? 'The server may collect bounded live vessel observations. A position never proves cargo assignment without a verified identifier.'
        : 'AISStream needs a server-side key; no browser connection is attempted.',
    },
    {
      id: 'ADSB_LOL',
      label: 'ADSB.lol aircraft traffic',
      configured: true,
      available: null,
      mode: 'public-live-source',
      fallbackActive: false,
      lastSuccessAt: null,
      latencyMs: null,
      truth: 'UNKNOWN',
      publicNote:
        'Public current aircraft observations with ODbL attribution. They do not prove shipment assignment.',
    },
    {
      id: 'NASA_EONET',
      label: 'NASA EONET events',
      configured: true,
      available: null,
      mode: 'public-live-source',
      fallbackActive: false,
      lastSuccessAt: null,
      latencyMs: null,
      truth: 'UNKNOWN',
      publicNote:
        'Current external hazard context with fetch time and freshness state; it does not validate historical evidence.',
    },
    {
      id: 'NAUTA',
      label: 'Nauta operational pattern',
      configured: false,
      available: false,
      mode: 'sponsor-access-required',
      fallbackActive: true,
      lastSuccessAt: null,
      latencyMs: null,
      truth: 'MOCK_CONNECTOR',
      publicNote:
        'No public self-service Nauta API is claimed. The runtime keeps a replaceable mock adapter until sponsor sandbox access is provided.',
    },
  ];

  return Response.json({
    generatedAt: new Date().toISOString(),
    secretsExposed: false,
    services,
  });
}
