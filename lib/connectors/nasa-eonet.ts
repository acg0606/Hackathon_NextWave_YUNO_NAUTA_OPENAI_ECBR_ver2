import type { ConnectorEnvelope } from './types';
import { z } from 'zod';

export type EonetContext = {
  eventId: string;
  title: string;
  category: string;
  observedAt: string | null;
  coordinates: [number, number] | null;
  sourceUrl: string;
};

type CachedContext = ConnectorEnvelope<EonetContext[]> & { cachedUntil: number };

const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20';
const TTL_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 512 * 1024;
let cached: CachedContext | null = null;

const eonetPayloadSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            id: z.string().max(128).optional(),
            title: z.string().max(300).optional(),
            categories: z
              .array(z.object({ title: z.string().max(120).optional() }).strip())
              .max(8)
              .optional(),
            geometry: z
              .array(
                z
                  .object({
                    date: z.string().max(64).optional(),
                    coordinates: z
                      .array(z.number().refine(Number.isFinite, 'Coordinate must be finite'))
                      .min(2)
                      .max(3)
                      .optional(),
                  })
                  .strip(),
              )
              .max(64)
              .optional(),
            sources: z
              .array(z.object({ url: z.string().max(2_048).optional() }).strip())
              .max(8)
              .optional(),
          })
          .strip(),
      )
      .max(100)
      .default([]),
  })
  .strip();

function plainText(value: string, limit: number) {
  return value.replace(/[<>]/g, '').trim().slice(0, limit);
}

function boundedCoordinates(value: number[] | undefined): [number, number] | null {
  if (!value || value.length < 2) return null;
  const longitude = value[0];
  const latitude = value[1];
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  return [longitude, latitude];
}

function safeUrl(value: unknown) {
  if (typeof value !== 'string') return 'https://eonet.gsfc.nasa.gov/';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const official = host === 'nasa.gov' || host.endsWith('.nasa.gov');
    return url.protocol === 'https:' && official
      ? url.toString()
      : 'https://eonet.gsfc.nasa.gov/';
  } catch {
    return 'https://eonet.gsfc.nasa.gov/';
  }
}

export async function fetchCurrentEonetContext(
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ConnectorEnvelope<EonetContext[]>> {
  const now = Date.now();
  if (cached && cached.cachedUntil > now) return cached;

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abortFromParent, { once: true });
  const requestedTimeout = options.timeoutMs ?? 4_000;
  const deadline = Number.isFinite(requestedTimeout)
    ? Math.min(5_000, Math.max(100, Math.round(requestedTimeout)))
    : 4_000;
  const timeout = setTimeout(() => controller.abort(), deadline);

  try {
    const response = await fetch(EONET_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`EONET returned ${response.status}`);
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error('EONET response exceeded the bounded payload limit.');
    }
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('EONET response exceeded the bounded payload limit.');
    }
    const payload = eonetPayloadSchema.parse(JSON.parse(raw));
    const data = payload.events.slice(0, 20).map((event, index) => {
      const geometry = event.geometry?.at(-1);
      const coordinates = boundedCoordinates(geometry?.coordinates);
      return {
        eventId: event.id ? plainText(event.id, 128) : `eonet-${index}`,
        title: event.title ? plainText(event.title, 200) : 'Untitled EONET event',
        category:
          event.categories?.[0]?.title
            ? plainText(event.categories[0].title, 100)
            : 'Unknown',
        observedAt: geometry?.date ?? null,
        coordinates,
        sourceUrl: safeUrl(event.sources?.[0]?.url),
      };
    });
    const fetchedAt = new Date().toISOString();
    cached = {
      connector: 'NASA_EONET',
      classification: 'LIVE_CURRENT_CONTEXT',
      status: 'available',
      fetchedAt,
      expiresAt: new Date(now + TTL_MS).toISOString(),
      data,
      publicNote:
        'Current NASA EONET context fetched at the displayed timestamp. It does not validate or recreate the selected historical event.',
      cachedUntil: now + TTL_MS,
    };
    return cached;
  } catch {
    if (cached?.data) {
      return {
        ...cached,
        status: 'stale',
        publicNote:
          'NASA EONET is temporarily unavailable. Showing the last successful context as stale; it does not validate the historical event.',
      };
    }
    return {
      connector: 'NASA_EONET',
      classification: 'UNKNOWN',
      status: 'unavailable',
      fetchedAt: new Date().toISOString(),
      data: null,
      publicNote:
        'NASA EONET current context is unavailable. No inference was made from the missing response.',
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
}

export function clearEonetCacheForTests() {
  cached = null;
}
