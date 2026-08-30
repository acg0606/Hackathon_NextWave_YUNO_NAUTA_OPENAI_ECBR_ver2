import type { AgentFallbackReason } from './agent-provider';

export type OpenAIProviderHealth = {
  available: boolean;
  fallbackActive: boolean;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  latencyMs: number;
  failureReason: AgentFallbackReason | null;
  providerStatus: number | null;
};

const processState = globalThis as typeof globalThis & {
  __routeShiftOpenAIHealth?: OpenAIProviderHealth;
};

function boundedLatency(value: number) {
  return Math.min(60_000, Math.max(0, Math.round(value)));
}

export function recordOpenAISuccess(latencyMs: number) {
  const now = new Date().toISOString();
  processState.__routeShiftOpenAIHealth = {
    available: true,
    fallbackActive: false,
    lastAttemptAt: now,
    lastSuccessAt: now,
    latencyMs: boundedLatency(latencyMs),
    failureReason: null,
    providerStatus: null,
  };
}

export function recordOpenAIFailure(input: {
  latencyMs: number;
  reason: AgentFallbackReason;
  providerStatus?: number;
}) {
  const previous = processState.__routeShiftOpenAIHealth;
  processState.__routeShiftOpenAIHealth = {
    available: false,
    fallbackActive: true,
    lastAttemptAt: new Date().toISOString(),
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    latencyMs: boundedLatency(input.latencyMs),
    failureReason: input.reason,
    providerStatus: input.providerStatus ?? null,
  };
}

export function getOpenAIProviderHealth(): OpenAIProviderHealth | null {
  return processState.__routeShiftOpenAIHealth
    ? { ...processState.__routeShiftOpenAIHealth }
    : null;
}
