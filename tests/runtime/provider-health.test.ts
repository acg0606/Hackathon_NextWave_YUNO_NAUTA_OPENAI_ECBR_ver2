import { describe, expect, it } from 'vitest';

import {
  getOpenAIProviderHealth,
  recordOpenAIFailure,
  recordOpenAISuccess,
} from '@/lib/agent/provider-health';

describe('OpenAI provider health telemetry', () => {
  it('stores only bounded public operational telemetry', () => {
    recordOpenAISuccess(1_234.4);
    expect(getOpenAIProviderHealth()).toMatchObject({
      available: true,
      fallbackActive: false,
      latencyMs: 1_234,
      failureReason: null,
      providerStatus: null,
    });

    recordOpenAIFailure({
      latencyMs: 80_000,
      reason: 'rate_limited',
      providerStatus: 429,
    });
    expect(getOpenAIProviderHealth()).toMatchObject({
      available: false,
      fallbackActive: true,
      latencyMs: 60_000,
      failureReason: 'rate_limited',
      providerStatus: 429,
    });
  });
});
