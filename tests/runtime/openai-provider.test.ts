import { afterEach, describe, expect, it } from 'vitest';

import { demoAgent } from '@/lib/agent/demo-agent';
import { classifyOpenAIProviderFailure, OpenAIAgent } from '@/lib/agent/openai-agent';

const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

describe('OpenAI agent public provider boundary', () => {
  it('makes missing configuration visible and uses the deterministic provider', async () => {
    delete process.env.OPENAI_API_KEY;
    const agent = new OpenAIAgent(demoAgent);
    const inference = await agent.inferStepWithTelemetry(
      'Validate Bill of Lading against booking before confirming.',
    );
    const summary = await agent.summarize({
      objective: 'Summarize the bounded order.',
      evidence: ['Order RS-NW26-014'],
      confidence: 0.98,
    });

    expect(inference.intent?.kind).toBe('validate');
    expect(inference.telemetry).toMatchObject({
      providerId: 'demo-agent-v1',
      providerMode: 'deterministic_fallback',
      fallbackReason: 'not_configured',
      structuredOutput: true,
    });
    expect(summary).toMatchObject({
      providerId: 'demo-agent-v1',
      providerMode: 'deterministic_fallback',
    });
  });

  it('classifies provider failures without exposing raw provider messages', () => {
    expect(classifyOpenAIProviderFailure({
      status: 429,
      code: 'insufficient_quota',
      message: 'sensitive upstream message',
    })).toEqual({ outcome: 'insufficient_quota', providerStatus: 429 });
    expect(classifyOpenAIProviderFailure({ name: 'APIConnectionTimeoutError' })).toEqual({
      outcome: 'provider_timeout',
      providerStatus: undefined,
    });
    expect(classifyOpenAIProviderFailure({ status: 401, code: 'invalid_api_key' })).toEqual({
      outcome: 'authentication_failed',
      providerStatus: 401,
    });
  });
});
