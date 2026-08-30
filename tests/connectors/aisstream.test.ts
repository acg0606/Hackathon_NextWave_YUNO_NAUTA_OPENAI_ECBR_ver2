import { describe, expect, it, vi } from 'vitest';

import {
  collectAISStream,
  type AISStreamRequest,
  type AISStreamWebSocket,
} from '@/lib/connectors/aisstream';

type SocketEvent = { data?: unknown };

class FakeSocket implements AISStreamWebSocket {
  readonly listeners = new Map<string, Set<(event: SocketEvent) => void>>();
  readonly sent: string[] = [];
  closed = false;

  addEventListener(type: string, listener: (event: SocketEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: SocketEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, event: SocketEvent = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const request: AISStreamRequest = {
  boundingBox: [
    [-25, -48],
    [-20, -43],
  ] as [[number, number], [number, number]],
  mmsi: ['368207620'],
  messageTypes: ['PositionReport'],
  maxMessages: 1,
};

function positionEnvelope(extra: Record<string, unknown> = {}) {
  return {
    MessageType: 'PositionReport',
    MetaData: {
      MMSI: 368207620,
      MMSI_String: '368207620',
      ShipName: 'EXAMPLE VESSEL',
      Latitude: -23.2,
      Longitude: -45.7,
      time_utc: '2026-08-30T08:11:25Z',
    },
    Message: {
      PositionReport: {
        MessageID: 1,
        RepeatIndicator: 0,
        UserID: 368207620,
        Valid: true,
        NavigationalStatus: 0,
        RateOfTurn: 0,
        Sog: 12.4,
        PositionAccuracy: true,
        Longitude: -45.7,
        Latitude: -23.2,
        Cog: 86.7,
        TrueHeading: 87,
        Timestamp: 25,
        SpecialManoeuvreIndicator: 0,
        Spare: 0,
        Raim: false,
        CommunicationState: 0,
        ...extra,
      },
    },
  };
}

async function flushMessages() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AISStream connector', () => {
  it('returns unavailable without a server-side key and never opens a socket', async () => {
    const webSocketFactory = vi.fn();

    const result = await collectAISStream(request, {
      apiKey: '   ',
      webSocketFactory,
    });

    expect(result).toMatchObject({
      connector: 'AISSTREAM',
      classification: 'UNKNOWN',
      status: 'unavailable',
      data: null,
    });
    expect(webSocketFactory).not.toHaveBeenCalled();
    expect(result.publicNote).toMatch(/AISSTREAM_API_KEY/);
  });

  it('subscribes immediately after open and returns bounded validated observations', async () => {
    const socket = new FakeSocket();
    const promise = collectAISStream(request, {
      apiKey: 'test-key-never-returned',
      webSocketFactory: (url) => {
        expect(url).toBe('wss://stream.aisstream.io/v0/stream');
        return socket;
      },
      now: () => 1_788_077_486_000,
      timeoutMs: 2_000,
    });

    socket.emit('open');
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] ?? '{}')).toEqual({
      APIKey: 'test-key-never-returned',
      BoundingBoxes: [request.boundingBox],
      FiltersShipMMSI: ['368207620'],
      FilterMessageTypes: ['PositionReport'],
    });

    socket.emit('message', {
      data: new TextEncoder().encode(
        JSON.stringify({
          MessageType: 'SubscriptionConfirmation',
          Message: { CompressionEnabled: true },
        }),
      ),
    });
    socket.emit('message', {
      data: new TextEncoder().encode(JSON.stringify(positionEnvelope())),
    });
    socket.emit('close');
    await flushMessages();
    const result = await promise;

    expect(result).toMatchObject({
      connector: 'AISSTREAM',
      classification: 'LIVE_CURRENT_CONTEXT',
      status: 'available',
    });
    expect(result.data).toMatchObject({
      subscriptionConfirmed: true,
      compressionEnabled: true,
      invalidFrames: 0,
    });
    expect(result.data?.observations[0]).toMatchObject({
      kind: 'position',
      mmsi: '368207620',
      shipName: 'EXAMPLE VESSEL',
      latitude: -23.2,
      longitude: -45.7,
      speedOverGroundKnots: 12.4,
    });
    expect(JSON.stringify(result)).not.toContain('test-key-never-returned');
    expect(socket.closed).toBe(true);
  });

  it('rejects unknown executable fields rather than exposing the frame', async () => {
    const socket = new FakeSocket();
    const promise = collectAISStream(request, {
      apiKey: 'test-key',
      webSocketFactory: () => socket,
      timeoutMs: 2_000,
    });

    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify(positionEnvelope({ html: '<script>alert(1)</script>' })),
    });
    await flushMessages();
    socket.emit('close');
    const result = await promise;

    expect(result.status).toBe('unavailable');
    expect(result.data).toBeNull();
    expect(JSON.stringify(result)).not.toContain('<script>');
  });

  it('rejects world-scale bounding boxes before reading the key or opening a socket', async () => {
    const webSocketFactory = vi.fn();

    await expect(
      collectAISStream(
        {
          boundingBox: [
            [-90, -180],
            [90, 180],
          ],
        },
        { apiKey: 'test-key', webSocketFactory },
      ),
    ).rejects.toThrow(/bounding box/i);
    expect(webSocketFactory).not.toHaveBeenCalled();
  });

  it('closes on an oversized frame without returning provider contents', async () => {
    const socket = new FakeSocket();
    const promise = collectAISStream(request, {
      apiKey: 'test-key',
      webSocketFactory: () => socket,
      maxBytes: 1_024,
      timeoutMs: 2_000,
    });

    socket.emit('open');
    socket.emit('message', { data: 'x'.repeat(2_000) });
    await flushMessages();
    const result = await promise;

    expect(result.status).toBe('unavailable');
    expect(result.data).toBeNull();
    expect(socket.closed).toBe(true);
  });
});
