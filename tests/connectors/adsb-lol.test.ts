import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAdsbLolCacheForTests,
  fetchAdsbLolAircraft,
} from '@/lib/connectors/adsb-lol';

const query = { latitude: -23.4356, longitude: -46.4731, radiusNm: 25 };

function providerPayload(extraAircraft: Record<string, unknown> = {}) {
  return {
    ac: [
      {
        hex: 'E49001',
        type: 'adsb_icao',
        messages: 42,
        mlat: [],
        rssi: -12.4,
        seen: 0.5,
        tisb: [],
        lat: -23.44,
        lon: -46.48,
        flight: 'TAM3500 ',
        r: 'PR-ABC',
        t: 'A320',
        alt_baro: 12_000,
        gs: 318.2,
        track: 91.5,
        baro_rate: 640,
        squawk: '1234',
        emergency: 'none',
        seen_pos: 1.25,
        dir: 284.8,
        dst: 14.606,
        ...extraAircraft,
      },
    ],
    ctime: 1,
    msg: 'No error',
    now: 1_788_077_485_501,
    ptime: 2,
    total: 1,
  };
}

function jsonResponse(payload: unknown, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: responseHeaders,
  });
}

describe('ADSB.lol connector', () => {
  beforeEach(() => clearAdsbLolCacheForTests());

  it('fetches and normalizes bounded live aircraft context', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      jsonResponse(providerPayload()),
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await fetchAdsbLolAircraft(query, {
      fetchImpl,
      now: () => 1_788_077_486_000,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.adsb.lol/v2/lat/-23.4356/lon/-46.4731/dist/25',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        accept: 'application/json',
        'user-agent': expect.stringContaining('RouteShift-NextWave/1.0'),
      },
    });
    expect(result).toMatchObject({
      connector: 'ADSB_LOL',
      classification: 'LIVE_CURRENT_CONTEXT',
      status: 'available',
    });
    expect(result.data?.aircraft[0]).toMatchObject({
      hex: 'e49001',
      callsign: 'TAM3500',
      registration: 'PR-ABC',
      aircraftType: 'A320',
      latitude: -23.44,
      longitude: -46.48,
      altitudeFeet: 12_000,
      onGround: false,
      bearingDegrees: 284.8,
      distanceNm: 14.606,
    });
    expect(result.publicNote).toMatch(/do not prove/i);
  });

  it('uses a per-query TTL cache and returns stale validated data after a failure', async () => {
    let clock = 1_788_077_486_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(providerPayload()))
      .mockRejectedValueOnce(new Error('provider unavailable')) as unknown as typeof fetch;

    const first = await fetchAdsbLolAircraft(query, {
      fetchImpl,
      ttlMs: 1_000,
      now: () => clock,
    });
    const cached = await fetchAdsbLolAircraft(query, {
      fetchImpl,
      ttlMs: 1_000,
      now: () => clock + 500,
    });
    expect(cached).toBe(first);
    expect(fetchImpl).toHaveBeenCalledOnce();

    clock += 1_001;
    const stale = await fetchAdsbLolAircraft(query, {
      fetchImpl,
      ttlMs: 1_000,
      now: () => clock,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(stale.status).toBe('stale');
    expect(stale.data?.aircraft[0]?.hex).toBe('e49001');
  });

  it('rejects unknown provider fields through the strict schema', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(providerPayload({ html: '<script>alert(1)</script>' })),
    ) as unknown as typeof fetch;

    const result = await fetchAdsbLolAircraft(query, { fetchImpl });

    expect(result.status).toBe('unavailable');
    expect(result.classification).toBe('UNKNOWN');
    expect(JSON.stringify(result)).not.toContain('<script>');
  });

  it('rejects out-of-range geographic enrichment while keeping the schema strict', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(providerPayload({ dir: 361, dst: 251 })),
    ) as unknown as typeof fetch;

    const result = await fetchAdsbLolAircraft(query, { fetchImpl });

    expect(result.status).toBe('unavailable');
    expect(result.data).toBeNull();
  });

  it('rejects oversized responses before materializing them', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(providerPayload(), { 'content-length': String(600 * 1024) }),
    ) as unknown as typeof fetch;

    const result = await fetchAdsbLolAircraft(query, { fetchImpl });

    expect(result.status).toBe('unavailable');
    expect(result.data).toBeNull();
  });

  it('rejects out-of-range queries without calling the provider', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      fetchAdsbLolAircraft(
        { latitude: 91, longitude: -46.4731, radiusNm: 25 },
        { fetchImpl },
      ),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
