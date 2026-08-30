import { afterEach, describe, expect, it } from 'vitest';

import { GET } from '@/app/api/integrations/status/route';

const variableNames = [
  'OPENAI_API_KEY',
  'AISSTREAM_API_KEY',
  'YUNO_ENV',
  'YUNO_ACCOUNT_CODE',
  'YUNO_PUBLIC_API_KEY',
  'YUNO_PRIVATE_SECRET_KEY',
] as const;

const original = Object.fromEntries(variableNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of variableNames) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('integration status route', () => {
  it('reports server capability modes without returning credential values', async () => {
    const secretSentinels = {
      openai: 'openai-secret-sentinel',
      ais: 'ais-secret-sentinel',
      yunoPublic: 'yuno-public-sentinel',
      yunoPrivate: 'yuno-private-sentinel',
    };
    process.env.OPENAI_API_KEY = secretSentinels.openai;
    process.env.AISSTREAM_API_KEY = secretSentinels.ais;
    process.env.YUNO_ENV = 'sandbox';
    process.env.YUNO_ACCOUNT_CODE = '11111111-1111-4111-8111-111111111111';
    process.env.YUNO_PUBLIC_API_KEY = secretSentinels.yunoPublic;
    process.env.YUNO_PRIVATE_SECRET_KEY = secretSentinels.yunoPrivate;

    const response = await GET();
    const text = await response.text();
    const body = JSON.parse(text) as {
      secretsExposed: boolean;
      services: Array<{ id: string; configured: boolean; mode: string; truth: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.secretsExposed).toBe(false);
    expect(body.services.find((service) => service.id === 'OPENAI')).toMatchObject({
      configured: true,
      mode: 'server-configured',
    });
    expect(body.services.find((service) => service.id === 'YUNO')).toMatchObject({
      configured: true,
      mode: 'external-sandbox',
      truth: 'EXTERNAL_SANDBOX',
    });
    expect(body.services.find((service) => service.id === 'NAUTA')).toMatchObject({
      configured: false,
      truth: 'MOCK_CONNECTOR',
    });
    for (const value of Object.values(secretSentinels)) expect(text).not.toContain(value);
  });
});
