import { describe, expect, it, vi } from 'vitest';

import {
  createYunoSandboxClientFromEnv,
  inspectYunoSandboxEnvironment,
  YUNO_SANDBOX_CLASSIFICATION,
  YunoSandboxClient,
  YunoSandboxError,
} from '@/lib/connectors/yuno-sandbox';

const ACCOUNT_CODE = '493e9374-510a-4201-9e09-de669d75f256';
const PAYMENT_ID = 'af170f9d-e8c1-47e4-a988-25535e0f88a1';
const TRANSACTION_ID = '89fd7fd0-951d-4335-ad1b-ef899a79630d';
const LINK_ID = '555933df-4eed-4af4-ae83-a32072ef34af';
const IDEMPOTENCY_KEY = '7bf41af5-70ae-4e79-9b28-a8fa75c3ac53';
const PUBLIC_KEY = 'public_test_key_123';
const PRIVATE_KEY = 'private_test_secret_456';
const NOW = new Date('2026-08-30T12:00:00.000Z');

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    merchant_order_id: 'RS-NW26-014',
    status: 'SUCCEEDED',
    sub_status: 'APPROVED',
    amount: { value: 5000, currency: 'USD', captured: 5000, refunded: 0 },
    transactions: [
      {
        id: TRANSACTION_ID,
        type: 'PURCHASE',
        status: 'SUCCEEDED',
        amount: 5000,
        provider_data: { should_not_escape_projection: true },
      },
    ],
    provider_secret_echo: PRIVATE_KEY,
    ...overrides,
  };
}

function client(fetchImplementation: (input: string | URL, init?: RequestInit) => Promise<Response>) {
  return new YunoSandboxClient(
    {
      environment: 'sandbox',
      accountCode: ACCOUNT_CODE,
      publicApiKey: PUBLIC_KEY,
      privateSecretKey: PRIVATE_KEY,
    },
    { fetch: fetchImplementation, now: () => NOW, timeoutMs: 250 },
  );
}

describe('YunoSandboxClient', () => {
  it('creates a real sandbox payment link with server-only credentials and idempotency', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: LINK_ID,
        merchant_order_id: 'RS-NW26-014',
        status: 'CREATED',
        redirect_url: `https://checkout.y.uno/payment_links/${LINK_ID}`,
        amount: { value: 5000, currency: 'USD' },
        capture: false,
        one_time_use: true,
        unexpected: '<script>not returned</script>',
      }),
    );

    const result = await client(fetchMock).createPaymentLink({
      idempotencyKey: IDEMPOTENCY_KEY,
      merchantOrderId: 'RS-NW26-014',
      description: 'RouteShift order RS-NW26-014',
      country: 'US',
      amount: { value: 5000, currency: 'USD' },
    });

    expect(result).toEqual({
      connector: 'YUNO',
      classification: 'EXTERNAL_SANDBOX',
      environment: 'sandbox',
      status: 'available',
      fetchedAt: NOW.toISOString(),
      data: {
        linkCode: LINK_ID,
        merchantOrderId: 'RS-NW26-014',
        status: 'CREATED',
        checkoutUrl: `https://checkout.y.uno/payment_links/${LINK_ID}`,
        amount: { value: 5000, currency: 'USD' },
        capture: false,
        oneTimeUse: true,
      },
      publicNote:
        'External Yuno Sandbox result. Test data only; no production funds or live accounting were affected.',
    });

    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api-sandbox.y.uno/v1/payment-links');
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({
      'public-api-key': PUBLIC_KEY,
      'private-secret-key': PRIVATE_KEY,
      'X-Idempotency-Key': IDEMPOTENCY_KEY,
    });
    expect(JSON.parse(typeof request.body === 'string' ? request.body : '')).toMatchObject({
      account_id: ACCOUNT_CODE,
      merchant_order_id: 'RS-NW26-014',
      payment_method_types: ['CARD'],
      capture: false,
      one_time_use: true,
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_KEY);
    expect(JSON.stringify(result)).not.toContain('unexpected');
  });

  it('accepts the current documented payment-link response shape', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        code: LINK_ID,
        status: 'CREATED',
        checkout_url: `https://checkout.y.uno/payment_links/${LINK_ID}`,
        amount: { value: 5000, currency: 'USD' },
        created_at: '2026-08-30T12:00:00Z',
      }),
    );

    const result = await client(fetchMock).createPaymentLink({
      idempotencyKey: IDEMPOTENCY_KEY,
      merchantOrderId: 'RS-NW26-014',
      description: 'RouteShift order RS-NW26-014',
      country: 'US',
      amount: { value: 5000, currency: 'USD' },
      capture: false,
      oneTimeUse: true,
    });

    expect(result.data).toEqual({
      linkCode: LINK_ID,
      merchantOrderId: 'RS-NW26-014',
      status: 'CREATED',
      checkoutUrl: `https://checkout.y.uno/payment_links/${LINK_ID}`,
      amount: { value: 5000, currency: 'USD' },
      capture: false,
      oneTimeUse: true,
    });
  });

  it('retrieves payments independently by merchant order ID and payment ID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([payment()]))
      .mockResolvedValueOnce(jsonResponse(payment()));
    const adapter = client(fetchMock);

    const byOrder = await adapter.retrievePaymentsByMerchantOrderId({
      merchantOrderId: 'RS-NW26-014',
    });
    const byId = await adapter.retrievePaymentById({ paymentId: PAYMENT_ID });

    expect(byOrder.classification).toBe(YUNO_SANDBOX_CLASSIFICATION);
    expect(byOrder.data).toHaveLength(1);
    expect(byOrder.data[0]).toMatchObject({
      id: PAYMENT_ID,
      merchantOrderId: 'RS-NW26-014',
      status: 'SUCCEEDED',
    });
    expect(byId.data.transactions[0]).toEqual({
      id: TRANSACTION_ID,
      type: 'PURCHASE',
      status: 'SUCCEEDED',
      amount: 5000,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api-sandbox.y.uno/v1/payments?merchant_order_id=RS-NW26-014',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://api-sandbox.y.uno/v1/payments/${PAYMENT_ID}`,
    );
    expect(JSON.stringify(byOrder)).not.toContain(PRIVATE_KEY);
  });

  it('captures and cancels or refunds with the caller idempotency key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: TRANSACTION_ID,
          type: 'CAPTURE',
          status: 'SUCCEEDED',
          response_code: 'SUCCEEDED',
          amount: { value: 5000, currency: 'USD', captured: 5000, refunded: 0 },
          payment: { id: PAYMENT_ID, status: 'SUCCEEDED' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: 'f2d6884a-f737-4565-ae32-ff60b19089e3',
            type: 'REFUND',
            status: 'REFUNDED',
            amount: { value: 5000, currency: 'USD', captured: 0, refunded: 5000 },
            payment: { id: PAYMENT_ID, status: 'REFUNDED' },
          },
          201,
        ),
      );
    const adapter = client(fetchMock);

    const captured = await adapter.capture({
      idempotencyKey: IDEMPOTENCY_KEY,
      paymentId: PAYMENT_ID,
      transactionId: TRANSACTION_ID,
      amount: { value: 5000, currency: 'USD' },
      description: 'Booking documents validated',
      merchantReference: 'CAP-RS-NW26-014',
    });
    const refunded = await adapter.cancelOrRefund({
      idempotencyKey: '0ff0180e-bb31-4d6e-a670-493824ec35a5',
      paymentId: PAYMENT_ID,
      reason: 'REQUESTED_BY_CUSTOMER',
      description: 'Transport mode changed',
      merchantReference: 'REF-RS-NW26-014',
      amount: { value: 5000, currency: 'USD' },
    });

    expect(captured.data).toMatchObject({
      type: 'CAPTURE',
      status: 'SUCCEEDED',
      paymentId: PAYMENT_ID,
    });
    expect(refunded.data).toMatchObject({
      type: 'REFUND',
      status: 'REFUNDED',
      paymentStatus: 'REFUNDED',
    });
    const captureRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const refundRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api-sandbox.y.uno/v1/payments/${PAYMENT_ID}/transactions/${TRANSACTION_ID}/capture`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://api-sandbox.y.uno/v1/payments/${PAYMENT_ID}/cancel-or-refund`,
    );
    expect(captureRequest.headers).toMatchObject({ 'X-Idempotency-Key': IDEMPOTENCY_KEY });
    expect(refundRequest.headers).toMatchObject({
      'X-Idempotency-Key': '0ff0180e-bb31-4d6e-a670-493824ec35a5',
    });
  });

  it('rejects unknown request properties and non-Yuno checkout URLs', async () => {
    const neverFetch = vi.fn(async () => jsonResponse({}));
    const adapter = client(neverFetch);

    await expect(
      adapter.createPaymentLink({
        idempotencyKey: IDEMPOTENCY_KEY,
        merchantOrderId: 'RS-NW26-014',
        description: 'RouteShift order RS-NW26-014',
        country: 'US',
        amount: { value: 5000, currency: 'USD' },
        arbitraryExecutableInstruction: '<script>alert(1)</script>',
      } as never),
    ).rejects.toMatchObject({ code: 'YUNO_VALIDATION_ERROR' });
    expect(neverFetch).not.toHaveBeenCalled();

    const maliciousResponse = vi.fn(async () =>
      jsonResponse({
        id: LINK_ID,
        merchant_order_id: 'RS-NW26-014',
        status: 'CREATED',
        redirect_url: 'https://attacker.example/payment',
        amount: { value: 5000, currency: 'USD' },
        capture: false,
        one_time_use: true,
      }),
    );
    await expect(
      client(maliciousResponse).createPaymentLink({
        idempotencyKey: IDEMPOTENCY_KEY,
        merchantOrderId: 'RS-NW26-014',
        description: 'RouteShift order RS-NW26-014',
        country: 'US',
        amount: { value: 5000, currency: 'USD' },
      }),
    ).rejects.toMatchObject({ code: 'YUNO_VALIDATION_ERROR' });
  });

  it('enforces a real timeout even when the injected fetch ignores AbortSignal', async () => {
    const adapter = new YunoSandboxClient(
      {
        environment: 'sandbox',
        accountCode: ACCOUNT_CODE,
        publicApiKey: PUBLIC_KEY,
        privateSecretKey: PRIVATE_KEY,
      },
      {
        fetch: () => new Promise(() => undefined),
        timeoutMs: 100,
      },
    );

    await expect(adapter.retrievePaymentById({ paymentId: PAYMENT_ID })).rejects.toMatchObject({
      code: 'YUNO_TIMEOUT',
      retriable: true,
    });
  });

  it('reports environment readiness without returning credential values', () => {
    const environment = {
      YUNO_ENV: 'sandbox',
      YUNO_ACCOUNT_CODE: ACCOUNT_CODE,
      YUNO_PUBLIC_API_KEY: PUBLIC_KEY,
      YUNO_PRIVATE_SECRET_KEY: PRIVATE_KEY,
    };
    const status = inspectYunoSandboxEnvironment(environment);
    const configured = createYunoSandboxClientFromEnv({
      environment,
      fetch: async () => jsonResponse({}),
    });
    const missing = createYunoSandboxClientFromEnv({ environment: {} });

    expect(status).toEqual({
      connector: 'YUNO',
      classification: 'EXTERNAL_SANDBOX',
      environment: 'sandbox',
      configured: true,
      missing: [],
      invalid: [],
    });
    expect(configured.client).toBeInstanceOf(YunoSandboxClient);
    expect(missing.client).toBeNull();
    expect(missing.status.missing).toEqual([
      'YUNO_ACCOUNT_CODE',
      'YUNO_PUBLIC_API_KEY',
      'YUNO_PRIVATE_SECRET_KEY',
    ]);
    expect(JSON.stringify(status)).not.toContain(PUBLIC_KEY);
    expect(JSON.stringify(status)).not.toContain(PRIVATE_KEY);
  });

  it('returns sanitized provider failures without logging or exposing secrets', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = client(async () =>
      jsonResponse(
        {
          code: 'INVALID_CREDENTIALS',
          messages: [`provider echoed ${PRIVATE_KEY}`],
        },
        401,
      ),
    );

    let failure: unknown;
    try {
      await adapter.retrievePaymentById({ paymentId: PAYMENT_ID });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(YunoSandboxError);
    expect(failure).toMatchObject({
      code: 'YUNO_INVALID_CREDENTIALS',
      httpStatus: 401,
      retriable: false,
    });
    expect(String(failure)).not.toContain(PRIVATE_KEY);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
