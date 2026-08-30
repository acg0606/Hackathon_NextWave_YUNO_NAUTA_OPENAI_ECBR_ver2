import { z } from 'zod';

import type { ConnectorEnvelope } from './types';

const ADSB_LOL_BASE_URL = 'https://api.adsb.lol';
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_TTL_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_CACHE_ENTRIES = 24;
const ADSB_USER_AGENT =
  'RouteShift-NextWave/1.0 (+https://github.com/acg0606/Hackathon-Nextwave-YUNO-NAUTA-OPENAI-ECBR)';

const finiteNumber = z.number();
const nullableFiniteNumber = finiteNumber.nullable().optional();
const nullableInteger = z.number().int().nullable().optional();
const shortNullableString = z.string().max(64).nullable().optional();

const lastPositionSchema = z
  .object({
    lat: finiteNumber.min(-90).max(90),
    lon: finiteNumber.min(-180).max(180),
    nic: z.number().int(),
    rc: z.number().int(),
    seen_pos: finiteNumber.nonnegative(),
  })
  .strict();

const aircraftSchema = z
  .object({
    alert: nullableInteger,
    alt_baro: z.union([z.number().int(), z.string().max(16)]).nullable().optional(),
    alt_geom: nullableInteger,
    baro_rate: nullableInteger,
    category: shortNullableString,
    emergency: shortNullableString,
    flight: shortNullableString,
    gs: nullableFiniteNumber,
    gva: nullableInteger,
    hex: z.string().trim().min(1).max(16),
    lat: finiteNumber.min(-90).max(90).nullable().optional(),
    lon: finiteNumber.min(-180).max(180).nullable().optional(),
    messages: z.number().int().nonnegative(),
    mlat: z.array(z.string().max(32)).max(64),
    nac_p: nullableInteger,
    nac_v: nullableInteger,
    nav_altitude_mcp: nullableInteger,
    nav_heading: nullableFiniteNumber,
    nav_qnh: nullableFiniteNumber,
    nic: nullableInteger,
    nic_baro: nullableInteger,
    r: shortNullableString,
    rc: nullableInteger,
    rssi: finiteNumber,
    sda: nullableInteger,
    seen: finiteNumber.nonnegative(),
    seen_pos: finiteNumber.nonnegative().nullable().optional(),
    sil: nullableInteger,
    sil_type: shortNullableString,
    spi: nullableInteger,
    squawk: shortNullableString,
    t: shortNullableString,
    tisb: z.array(z.string().max(32)).max(64),
    track: nullableFiniteNumber,
    type: z.string().max(32),
    version: nullableInteger,
    geom_rate: nullableInteger,
    dbFlags: nullableInteger,
    nav_modes: z.array(z.string().max(40)).max(16).nullable().optional(),
    true_heading: nullableFiniteNumber,
    ias: nullableInteger,
    mach: nullableFiniteNumber,
    mag_heading: nullableFiniteNumber,
    oat: nullableInteger,
    roll: nullableFiniteNumber,
    tas: nullableInteger,
    tat: nullableInteger,
    track_rate: nullableFiniteNumber,
    wd: nullableInteger,
    ws: nullableInteger,
    gpsOkBefore: nullableFiniteNumber,
    gpsOkLat: nullableFiniteNumber,
    gpsOkLon: nullableFiniteNumber,
    lastPosition: lastPositionSchema.nullable().optional(),
    rr_lat: nullableFiniteNumber,
    rr_lon: nullableFiniteNumber,
    calc_track: nullableInteger,
    nav_altitude_fms: nullableInteger,
    dir: finiteNumber.min(0).max(360).nullable().optional(),
    dst: finiteNumber.min(0).max(250).nullable().optional(),
  })
  .strict();

const adsbResponseSchema = z
  .object({
    ac: z.array(aircraftSchema).max(2_000),
    ctime: z.number().int().nonnegative(),
    msg: z.string().max(200),
    now: z.number().int().nonnegative(),
    ptime: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

const adsbQuerySchema = z
  .object({
    latitude: finiteNumber.min(-90).max(90),
    longitude: finiteNumber.min(-180).max(180),
    radiusNm: finiteNumber.min(1).max(250),
  })
  .strict();

export type AdsbLolQuery = z.infer<typeof adsbQuerySchema>;

export type AdsbLolAircraftObservation = {
  hex: string;
  callsign: string | null;
  registration: string | null;
  aircraftType: string | null;
  latitude: number;
  longitude: number;
  altitudeFeet: number | null;
  onGround: boolean;
  groundSpeedKnots: number | null;
  trackDegrees: number | null;
  verticalRateFeetPerMinute: number | null;
  squawk: string | null;
  emergency: string | null;
  bearingDegrees: number | null;
  distanceNm: number | null;
  seenSecondsAgo: number;
  positionSeenSecondsAgo: number | null;
  observedAt: string;
};

export type AdsbLolContext = {
  query: AdsbLolQuery;
  providerTimestamp: string;
  providerTotal: number;
  aircraft: AdsbLolAircraftObservation[];
  attribution: string;
  sourceUrl: string;
};

export type AdsbLolEnvelope = Omit<ConnectorEnvelope<AdsbLolContext>, 'connector'> & {
  connector: 'ADSB_LOL';
};

export type AdsbLolOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  signal?: AbortSignal;
  now?: () => number;
};

type CacheEntry = {
  cachedUntil: number;
  envelope: AdsbLolEnvelope;
};

const cache = new Map<string, CacheEntry>();

function clampedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value as number)));
}

function cacheKey(query: AdsbLolQuery) {
  return `${query.latitude}:${query.longitude}:${query.radiusNm}`;
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

async function readBoundedText(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('ADSB.lol response exceeded the bounded payload limit.');
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('ADSB.lol response exceeded the bounded payload limit.');
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('bounded payload exceeded');
        throw new Error('ADSB.lol response exceeded the bounded payload limit.');
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function normalizeAircraft(
  aircraft: z.infer<typeof aircraftSchema>,
  providerNow: number,
): AdsbLolAircraftObservation | null {
  const latitude = aircraft.lat ?? aircraft.lastPosition?.lat;
  const longitude = aircraft.lon ?? aircraft.lastPosition?.lon;
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return null;
  }

  const positionSeenSecondsAgo = aircraft.seen_pos ?? aircraft.lastPosition?.seen_pos ?? null;
  const ageSeconds = positionSeenSecondsAgo ?? aircraft.seen;
  const altitudeFeet = typeof aircraft.alt_baro === 'number' ? aircraft.alt_baro : null;

  return {
    hex: aircraft.hex.toLowerCase(),
    callsign: trimOrNull(aircraft.flight),
    registration: trimOrNull(aircraft.r),
    aircraftType: trimOrNull(aircraft.t),
    latitude,
    longitude,
    altitudeFeet,
    onGround: aircraft.alt_baro === 'ground',
    groundSpeedKnots: aircraft.gs ?? null,
    trackDegrees: aircraft.track ?? null,
    verticalRateFeetPerMinute: aircraft.baro_rate ?? aircraft.geom_rate ?? null,
    squawk: trimOrNull(aircraft.squawk),
    emergency: trimOrNull(aircraft.emergency),
    bearingDegrees: aircraft.dir ?? null,
    distanceNm: aircraft.dst ?? null,
    seenSecondsAgo: aircraft.seen,
    positionSeenSecondsAgo,
    observedAt: new Date(Math.max(0, providerNow - ageSeconds * 1_000)).toISOString(),
  };
}

function remember(key: string, entry: CacheEntry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function fetchAdsbLolAircraft(
  input: AdsbLolQuery,
  options: AdsbLolOptions = {},
): Promise<AdsbLolEnvelope> {
  const query = adsbQuerySchema.parse(input);
  const now = options.now ?? Date.now;
  const requestedAt = now();
  const key = cacheKey(query);
  const cached = cache.get(key);
  if (cached && cached.cachedUntil > requestedAt) return cached.envelope;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = clampedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 10_000);
  const ttlMs = clampedInteger(options.ttlMs, DEFAULT_TTL_MS, 1_000, 60_000);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort('ADSB.lol request timed out'), timeoutMs);
  const url = `${ADSB_LOL_BASE_URL}/v2/lat/${query.latitude}/lon/${query.longitude}/dist/${query.radiusNm}`;

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': ADSB_USER_AGENT,
      },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`ADSB.lol returned ${response.status}`);

    const raw = await readBoundedText(response, MAX_RESPONSE_BYTES);
    const parsed = adsbResponseSchema.parse(JSON.parse(raw));
    const providerTimestamp = new Date(parsed.now).toISOString();
    const data: AdsbLolContext = {
      query,
      providerTimestamp,
      providerTotal: parsed.total,
      aircraft: parsed.ac
        .map((aircraft) => normalizeAircraft(aircraft, parsed.now))
        .filter((aircraft): aircraft is AdsbLolAircraftObservation => aircraft !== null),
      attribution: 'Live aircraft data from ADSB.lol contributors, ODbL 1.0.',
      sourceUrl: ADSB_LOL_BASE_URL,
    };
    const fetchedAt = new Date(now()).toISOString();
    const envelope: AdsbLolEnvelope = {
      connector: 'ADSB_LOL',
      classification: 'LIVE_CURRENT_CONTEXT',
      status: 'available',
      fetchedAt,
      expiresAt: new Date(now() + ttlMs).toISOString(),
      data,
      publicNote:
        'Current ADS-B observations near the requested location. They do not prove that a RouteShift order is assigned to any displayed aircraft.',
    };
    remember(key, { cachedUntil: now() + ttlMs, envelope });
    return envelope;
  } catch {
    if (cached?.envelope.data) {
      return {
        ...cached.envelope,
        status: 'stale',
        publicNote:
          'ADSB.lol is temporarily unavailable. Showing the last validated aircraft observations as stale; no shipment-to-flight assignment is implied.',
      };
    }
    return {
      connector: 'ADSB_LOL',
      classification: 'UNKNOWN',
      status: 'unavailable',
      fetchedAt: new Date(now()).toISOString(),
      data: null,
      publicNote:
        'Live ADS-B context is unavailable. No aircraft position or shipment assignment was inferred.',
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
}

export function clearAdsbLolCacheForTests() {
  cache.clear();
}
