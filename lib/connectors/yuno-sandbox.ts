import { z } from 'zod';

export const YUNO_SANDBOX_CLASSIFICATION = 'EXTERNAL_SANDBOX' as const;

const YUNO_SANDBOX_BASE_URL = 'https://api-sandbox.y.uno/v1';
const MAX_RESPONSE_BYTES = 1_000_000;

const yunoIdSchema = z.uuid();
const idempotencyKeySchema = z.uuid();
const merchantIdentifierSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const descriptionSchema = z.string().trim().min(3).max(255);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const countrySchema = z.enum([
  'AR',
  'BO',
  'BR',
  'CL',
  'CO',
  'CR',
  'EC',
  'SV',
  'GT',
  'HN',
  'MX',
  'NI',
  'PA',
  'PY',
  'PE',
  'US',
  'UY',
]);
const amountSchema = z
  .object({
    value: z.number().int().positive().max(999_999_999_999),
    currency: currencySchema,
  })
  .strict();
const responseAmountSchema = amountSchema.extend({
  captured: z.number().int().nonnegative().optional(),
  refunded: z.number().int().nonnegative().optional(),
}).strict();

const safeCallbackUrlSchema = z
  .url()
  .max(256)
  .refine((value) => new URL(value).protocol === 'https:', 'Callback URL must use HTTPS');
const sandboxCheckoutUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'checkout.sandbox.y.uno' || url.hostname === 'checkout.y.uno')
    );
  }, 'Unexpected Yuno checkout URL');

const availabilitySchema = z
  .object({
    startAt: z.iso.datetime({ offset: true }),
    finishAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    ({ startAt, finishAt }) => Date.parse(finishAt) > Date.parse(startAt),
    'finishAt must be after startAt',
  );

export const yunoCreatePaymentLinkInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    merchantOrderId: merchantIdentifierSchema,
    description: descriptionSchema,
    country: countrySchema,
    amount: amountSchema,
    capture: z.boolean().default(false),
    oneTimeUse: z.boolean().default(true),
    callbackUrl: safeCallbackUrlSchema.optional(),
    availability: availabilitySchema.optional(),
  })
  .strict();

export const yunoRetrieveByMerchantOrderInputSchema = z
  .object({ merchantOrderId: merchantIdentifierSchema })
  .strict();

export const yunoRetrievePaymentInputSchema = z.object({ paymentId: yunoIdSchema }).strict();

export const yunoCaptureInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    paymentId: yunoIdSchema,
    transactionId: yunoIdSchema,
    amount: amountSchema,
    description: descriptionSchema,
    reason: z
      .enum(['PRODUCT_CONFIRMED', 'REQUESTED_BY_CUSTOMER'])
      .default('PRODUCT_CONFIRMED'),
    merchantReference: merchantIdentifierSchema,
  })
  .strict();

export const yunoCancelOrRefundInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    paymentId: yunoIdSchema,
    reason: z.enum(['DUPLICATE', 'FRAUDULENT', 'REQUESTED_BY_CUSTOMER', 'REVERSE']),
    description: descriptionSchema.optional(),
    merchantReference: merchantIdentifierSchema.optional(),
    amount: amountSchema.optional(),
  })
  .strict();

const paymentLinkStatusSchema = z.enum([
  'ACTIVE',
  'CREATED',
  'USED',
  'CANCELED',
  'EXPIRED',
  'ERROR',
]);
const paymentStatusSchema = z.enum([
  'CREATED',
  'PENDING',
  'READY_TO_PAY',
  'SUCCEEDED',
  'DECLINED',
  'REJECTED',
  'ERROR',
  'CANCELED',
  'REFUNDED',
  'EXPIRED',
]);
const transactionTypeSchema = z.enum([
  'PURCHASE',
  'AUTHORIZE',
  'CAPTURE',
  'REFUND',
  'CANCEL',
  'VERIFY',
  'CHARGEBACK',
  'FRAUD',
]);
const transactionStatusSchema = z.enum([
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'DECLINED',
  'REJECTED',
  'ERROR',
  'CANCELED',
  'REFUNDED',
  'EXPIRED',
  'PREVENTED',
]);

export const yunoPaymentLinkSchema = z
  .object({
    linkCode: yunoIdSchema,
    merchantOrderId: merchantIdentifierSchema.optional(),
    status: paymentLinkStatusSchema,
    checkoutUrl: sandboxCheckoutUrlSchema,
    amount: amountSchema,
    capture: z.boolean(),
    oneTimeUse: z.boolean(),
  })
  .strict();

const yunoTransactionSchema = z
  .object({
    id: yunoIdSchema,
    type: transactionTypeSchema,
    status: transactionStatusSchema,
    amount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const yunoPaymentSchema = z
  .object({
    id: yunoIdSchema,
    merchantOrderId: merchantIdentifierSchema,
    status: paymentStatusSchema,
    subStatus: z.string().min(1).max(64).optional(),
    amount: responseAmountSchema,
    transactions: z.array(yunoTransactionSchema).max(100),
  })
  .strict();

export const yunoOperationSchema = z
  .object({
    id: yunoIdSchema,
    type: transactionTypeSchema,
    status: transactionStatusSchema,
    responseCode: z.string().min(1).max(64).optional(),
    paymentId: yunoIdSchema.optional(),
    paymentStatus: paymentStatusSchema.optional(),
    amount: responseAmountSchema.optional(),
  })
  .strict();

export type YunoCreatePaymentLinkInput = z.input<typeof yunoCreatePaymentLinkInputSchema>;
export type YunoRetrieveByMerchantOrderInput = z.input<
  typeof yunoRetrieveByMerchantOrderInputSchema
>;
export type YunoRetrievePaymentInput = z.input<typeof yunoRetrievePaymentInputSchema>;
export type YunoCaptureInput = z.input<typeof yunoCaptureInputSchema>;
export type YunoCancelOrRefundInput = z.input<typeof yunoCancelOrRefundInputSchema>;
export type YunoSandboxPaymentLink = z.output<typeof yunoPaymentLinkSchema>;
export type YunoSandboxPayment = z.output<typeof yunoPaymentSchema>;
export type YunoSandboxOperation = z.output<typeof yunoOperationSchema>;

export type YunoSandboxEnvelope<T> = {
  connector: 'YUNO';
  classification: typeof YUNO_SANDBOX_CLASSIFICATION;
  environment: 'sandbox';
  status: 'available';
  fetchedAt: string;
  data: T;
  publicNote: string;
};

type YunoFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type YunoSandboxClientOptions = {
  fetch?: YunoFetch;
  timeoutMs?: number;
  now?: () => Date;
};

type Environment = Readonly<Record<string, string | undefined>>;

const credentialSchema = z
  .string()
  .trim()
  .min(8)
  .max(512)
  .regex(/^[\x21-\x7e]+$/, 'Credential contains unsupported characters');
const configSchema = z
  .object({
    environment: z.literal('sandbox'),
    accountCode: yunoIdSchema,
    publicApiKey: credentialSchema,
    privateSecretKey: credentialSchema,
  })
  .strict();
const timeoutSchema = z.number().int().min(100).max(60_000);

type YunoSandboxConfig = z.output<typeof configSchema>;

export type YunoSandboxConfigurationStatus = {
  connector: 'YUNO';
  classification: typeof YUNO_SANDBOX_CLASSIFICATION;
  environment: 'sandbox';
  configured: boolean;
  missing: string[];
  invalid: string[];
};

export class YunoSandboxError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly retriable: boolean;

  constructor(
    code: string,
    message: string,
    options: { httpStatus?: number; retriable?: boolean } = {},
  ) {
    super(message);
    this.name = 'YunoSandboxError';
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.retriable = options.retriable ?? false;
  }
}

function ensureServerRuntime() {
  if (typeof window !== 'undefined') {
    throw new YunoSandboxError(
      'YUNO_SERVER_ONLY',
      'The Yuno Sandbox connector can only be initialized on the server.',
    );
  }
}

function issueFields(error: z.ZodError) {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? 'input')))].sort();
}

function parseStrict<T>(schema: z.ZodType<T>, value: unknown, boundary: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new YunoSandboxError(
      'YUNO_VALIDATION_ERROR',
      `Invalid ${boundary}: ${issueFields(parsed.error).join(', ')}.`,
    );
  }
  return parsed.data;
}

function parseConfig(value: unknown): YunoSandboxConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    throw new YunoSandboxError(
      'YUNO_CONFIGURATION_INVALID',
      `Invalid Yuno Sandbox configuration: ${issueFields(parsed.error).join(', ')}.`,
    );
  }
  return parsed.data;
}

function asRecord(value: unknown, boundary: string): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) {
    throw new YunoSandboxError(
      'YUNO_INVALID_RESPONSE',
      `Yuno Sandbox returned an invalid ${boundary}.`,
    );
  }
  return parsed.data;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function projectAmount(value: unknown): z.input<typeof responseAmountSchema> {
  const amount = asRecord(value, 'amount');
  return {
    value: amount.value,
    currency: amount.currency,
    ...(amount.captured === undefined ? {} : { captured: amount.captured }),
    ...(amount.refunded === undefined ? {} : { refunded: amount.refunded }),
  } as z.input<typeof responseAmountSchema>;
}

function projectPaymentLink(
  value: unknown,
  requested: { merchantOrderId: string; capture: boolean; oneTimeUse: boolean },
): YunoSandboxPaymentLink {
  const raw = asRecord(value, 'payment link response');
  return parseStrict(
    yunoPaymentLinkSchema,
    {
      linkCode: raw.code ?? raw.id,
      ...(optionalString(raw.merchant_order_id)
        ? { merchantOrderId: raw.merchant_order_id }
        : { merchantOrderId: requested.merchantOrderId }),
      status: raw.status === 'CANCELLED' ? 'CANCELED' : raw.status,
      checkoutUrl: raw.checkout_url ?? raw.redirect_url,
      amount: projectAmount(raw.amount),
      capture: raw.capture ?? requested.capture,
      oneTimeUse: raw.one_time_use ?? requested.oneTimeUse,
    },
    'payment link response',
  );
}

function projectTransaction(value: unknown) {
  const raw = asRecord(value, 'transaction');
  return parseStrict(
    yunoTransactionSchema,
    {
      id: raw.id,
      type: raw.type,
      status: raw.status,
      ...(raw.amount === undefined ? {} : { amount: raw.amount }),
    },
    'transaction response',
  );
}

function projectPayment(value: unknown): YunoSandboxPayment {
  const raw = asRecord(value, 'payment response');
  const rawTransactions = raw.transactions === undefined ? [] : raw.transactions;
  if (!Array.isArray(rawTransactions)) {
    throw new YunoSandboxError(
      'YUNO_INVALID_RESPONSE',
      'Yuno Sandbox returned an invalid payment transaction list.',
    );
  }
  return parseStrict(
    yunoPaymentSchema,
    {
      id: raw.id,
      merchantOrderId: raw.merchant_order_id,
      status: raw.status,
      ...(optionalString(raw.sub_status) ? { subStatus: raw.sub_status } : {}),
      amount: projectAmount(raw.amount),
      transactions: rawTransactions.map(projectTransaction),
    },
    'payment response',
  );
}

function projectOperation(value: unknown): YunoSandboxOperation {
  const raw = asRecord(value, 'operation response');
  const payment = raw.payment === undefined ? undefined : asRecord(raw.payment, 'payment response');
  return parseStrict(
    yunoOperationSchema,
    {
      id: raw.id,
      type: raw.type,
      status: raw.status,
      ...(optionalString(raw.response_code) ? { responseCode: raw.response_code } : {}),
      ...(optionalString(payment?.id) ? { paymentId: payment?.id } : {}),
      ...(optionalString(payment?.status) ? { paymentStatus: payment?.status } : {}),
      ...(raw.amount === undefined ? {} : { amount: projectAmount(raw.amount) }),
    },
    'operation response',
  );
}

function safeProviderCode(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(value)) return undefined;
  return value;
}

function envelope<T>(data: T, now: () => Date): YunoSandboxEnvelope<T> {
  return {
    connector: 'YUNO',
    classification: YUNO_SANDBOX_CLASSIFICATION,
    environment: 'sandbox',
    status: 'available',
    fetchedAt: now().toISOString(),
    data,
    publicNote:
      'External Yuno Sandbox result. Test data only; no production funds or live accounting were affected.',
  };
}

export function inspectYunoSandboxEnvironment(
  environment: Environment = process.env,
): YunoSandboxConfigurationStatus {
  ensureServerRuntime();
  const required = ['YUNO_ACCOUNT_CODE', 'YUNO_PUBLIC_API_KEY', 'YUNO_PRIVATE_SECRET_KEY'] as const;
  const missing = required.filter((key) => !environment[key]?.trim());
  const candidate = {
    environment: environment.YUNO_ENV?.trim() || 'sandbox',
    accountCode: environment.YUNO_ACCOUNT_CODE?.trim(),
    publicApiKey: environment.YUNO_PUBLIC_API_KEY?.trim(),
    privateSecretKey: environment.YUNO_PRIVATE_SECRET_KEY?.trim(),
  };
  const parsed = missing.length === 0 ? configSchema.safeParse(candidate) : undefined;

  return {
    connector: 'YUNO',
    classification: YUNO_SANDBOX_CLASSIFICATION,
    environment: 'sandbox',
    configured: missing.length === 0 && parsed?.success === true,
    missing: [...missing],
    invalid: parsed && !parsed.success ? issueFields(parsed.error) : [],
  };
}

export function createYunoSandboxClientFromEnv(options: {
  environment?: Environment;
  fetch?: YunoFetch;
  timeoutMs?: number;
  now?: () => Date;
} = {}) {
  ensureServerRuntime();
  const environment = options.environment ?? process.env;
  const status = inspectYunoSandboxEnvironment(environment);
  if (!status.configured) return { client: null, status } as const;

  const timeoutFromEnvironment = environment.YUNO_TIMEOUT_MS
    ? Number(environment.YUNO_TIMEOUT_MS)
    : undefined;
  const timeoutMs = options.timeoutMs ?? timeoutFromEnvironment;
  const config = parseConfig({
    environment: environment.YUNO_ENV?.trim() || 'sandbox',
    accountCode: environment.YUNO_ACCOUNT_CODE?.trim(),
    publicApiKey: environment.YUNO_PUBLIC_API_KEY?.trim(),
    privateSecretKey: environment.YUNO_PRIVATE_SECRET_KEY?.trim(),
  });

  return {
    client: new YunoSandboxClient(config, {
      fetch: options.fetch,
      timeoutMs,
      now: options.now,
    }),
    status,
  } as const;
}

export class YunoSandboxClient {
  readonly #accountCode: string;
  readonly #publicApiKey: string;
  readonly #privateSecretKey: string;
  readonly #fetch: YunoFetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(configInput: unknown, options: YunoSandboxClientOptions = {}) {
    ensureServerRuntime();
    const config = parseConfig(configInput);
    const selectedFetch = options.fetch ?? (globalThis.fetch as YunoFetch | undefined);
    if (!selectedFetch) {
      throw new YunoSandboxError('YUNO_FETCH_UNAVAILABLE', 'No server-side fetch is available.');
    }

    this.#accountCode = config.accountCode;
    this.#publicApiKey = config.publicApiKey;
    this.#privateSecretKey = config.privateSecretKey;
    this.#fetch = selectedFetch;
    this.#timeoutMs = parseStrict(timeoutSchema, options.timeoutMs ?? 15_000, 'timeout');
    this.#now = options.now ?? (() => new Date());
  }

  async createPaymentLink(input: YunoCreatePaymentLinkInput) {
    const validated = parseStrict(
      yunoCreatePaymentLinkInputSchema,
      input,
      'create payment link request',
    );
    const result = await this.#request('/payment-links', {
      method: 'POST',
      idempotencyKey: validated.idempotencyKey,
      body: {
        account_id: this.#accountCode,
        merchant_order_id: validated.merchantOrderId,
        description: validated.description,
        country: validated.country,
        amount: validated.amount,
        payment_method_types: ['CARD'],
        capture: validated.capture,
        one_time_use: validated.oneTimeUse,
        ...(validated.callbackUrl ? { callback_url: validated.callbackUrl } : {}),
        ...(validated.availability
          ? {
              availability: {
                start_at: validated.availability.startAt,
                finish_at: validated.availability.finishAt,
              },
            }
          : {}),
      },
    });
    return envelope(
      projectPaymentLink(result, {
        merchantOrderId: validated.merchantOrderId,
        capture: validated.capture,
        oneTimeUse: validated.oneTimeUse,
      }),
      this.#now,
    );
  }

  async retrievePaymentsByMerchantOrderId(input: YunoRetrieveByMerchantOrderInput) {
    const validated = parseStrict(
      yunoRetrieveByMerchantOrderInputSchema,
      input,
      'retrieve payment request',
    );
    const query = new URLSearchParams({ merchant_order_id: validated.merchantOrderId });
    const result = await this.#request(`/payments?${query.toString()}`, { method: 'GET' });
    if (!Array.isArray(result)) {
      throw new YunoSandboxError(
        'YUNO_INVALID_RESPONSE',
        'Yuno Sandbox returned an invalid payment list.',
      );
    }
    return envelope(result.map(projectPayment), this.#now);
  }

  async retrievePaymentById(input: YunoRetrievePaymentInput) {
    const validated = parseStrict(
      yunoRetrievePaymentInputSchema,
      input,
      'retrieve payment request',
    );
    const result = await this.#request(`/payments/${validated.paymentId}`, { method: 'GET' });
    return envelope(projectPayment(result), this.#now);
  }

  async capture(input: YunoCaptureInput) {
    const validated = parseStrict(yunoCaptureInputSchema, input, 'capture request');
    const result = await this.#request(
      `/payments/${validated.paymentId}/transactions/${validated.transactionId}/capture`,
      {
        method: 'POST',
        idempotencyKey: validated.idempotencyKey,
        body: {
          amount: validated.amount,
          description: validated.description,
          reason: validated.reason,
          merchant_reference: validated.merchantReference,
        },
      },
    );
    return envelope(projectOperation(result), this.#now);
  }

  async cancelOrRefund(input: YunoCancelOrRefundInput) {
    const validated = parseStrict(
      yunoCancelOrRefundInputSchema,
      input,
      'cancel or refund request',
    );
    const result = await this.#request(`/payments/${validated.paymentId}/cancel-or-refund`, {
      method: 'POST',
      idempotencyKey: validated.idempotencyKey,
      body: {
        reason: validated.reason,
        ...(validated.description ? { description: validated.description } : {}),
        ...(validated.merchantReference
          ? { merchant_reference: validated.merchantReference }
          : {}),
        ...(validated.amount ? { amount: validated.amount } : {}),
      },
    });
    return envelope(projectOperation(result), this.#now);
  }

  async #request(
    path: string,
    request: {
      method: 'GET' | 'POST';
      idempotencyKey?: string;
      body?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(
          new YunoSandboxError('YUNO_TIMEOUT', 'Yuno Sandbox did not respond in time.', {
            retriable: true,
          }),
        );
      }, this.#timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.#fetch(`${YUNO_SANDBOX_BASE_URL}${path}`, {
          method: request.method,
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            ...(request.body ? { 'content-type': 'application/json' } : {}),
            'public-api-key': this.#publicApiKey,
            'private-secret-key': this.#privateSecretKey,
            ...(request.idempotencyKey
              ? { 'X-Idempotency-Key': request.idempotencyKey }
              : {}),
          },
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        }),
        timeout,
      ]);
      const responseText = await response.text();
      if (responseText.length > MAX_RESPONSE_BYTES) {
        throw new YunoSandboxError(
          'YUNO_RESPONSE_TOO_LARGE',
          'Yuno Sandbox returned a response larger than the accepted limit.',
        );
      }

      let payload: unknown;
      try {
        payload = responseText.length === 0 ? {} : JSON.parse(responseText);
      } catch {
        throw new YunoSandboxError(
          'YUNO_INVALID_RESPONSE',
          'Yuno Sandbox returned a non-JSON response.',
          { httpStatus: response.status },
        );
      }

      if (!response.ok) {
        const providerCode = safeProviderCode(
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>).code
            : undefined,
        );
        throw new YunoSandboxError(
          providerCode ? `YUNO_${providerCode}` : 'YUNO_HTTP_ERROR',
          `Yuno Sandbox request failed with HTTP ${response.status}.`,
          {
            httpStatus: response.status,
            retriable: response.status === 429 || response.status >= 500,
          },
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof YunoSandboxError) throw error;
      throw new YunoSandboxError('YUNO_NETWORK_ERROR', 'Yuno Sandbox request failed.', {
        retriable: true,
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
