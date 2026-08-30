import type { JsonObject, JsonValue, RunEvent } from './contracts';
import { jsonObjectSchema, runEventSchema } from './schemas';

const PRIVATE_KEYS = new Set([
  'accesstoken',
  'analysis',
  'authorization',
  'apikey',
  'chainofthought',
  'cookie',
  'developerprompt',
  'headers',
  'password',
  'prompt',
  'rawrequest',
  'rawresponse',
  'reasoning',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'systemprompt',
  'token',
]);

const secretPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:api[_ -]?key|secret|password|token)\s*[:=]\s*[^\s,;]+/gi,
];

function sanitizeText(value: string): string {
  return secretPatterns.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, '[REDACTED]'),
    value,
  );
}

function sanitizeValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') return sanitizeText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);

  const sanitized: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (PRIVATE_KEYS.has(normalizedKey)) continue;
    sanitized[key] = sanitizeValue(item);
  }
  return sanitized;
}

export function sanitizePublicPayload(payload: JsonObject): JsonObject {
  return jsonObjectSchema.parse(sanitizeValue(payload));
}

export function sanitizePublicEvent(event: RunEvent): RunEvent {
  const validated = runEventSchema.parse(event);
  return runEventSchema.parse({
    ...validated,
    payload: sanitizePublicPayload(validated.payload),
  }) as RunEvent;
}

export function assertPublicEventSafe(event: RunEvent): void {
  const validated = runEventSchema.parse(event) as RunEvent;
  const sanitized = sanitizePublicEvent(validated);
  if (JSON.stringify(validated.payload) !== JSON.stringify(sanitized.payload)) {
    throw new Error(
      `Run event ${event.eventId} contains private or secret-bearing public fields`,
    );
  }
}
