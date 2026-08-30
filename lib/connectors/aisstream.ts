import { z } from 'zod';

import type { ConnectorEnvelope } from './types';

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_MESSAGES = 25;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_BBOX_SPAN_DEGREES = 10;
const LIVE_TTL_MS = 60_000;

const finiteNumber = z.number();
const messageTypeSchema = z.enum(['PositionReport', 'ShipStaticData']);
const coordinateSchema = z.tuple([
  finiteNumber.min(-90).max(90),
  finiteNumber.min(-180).max(180),
]);

const boundingBoxSchema = z
  .tuple([coordinateSchema, coordinateSchema])
  .superRefine((box, context) => {
    const latitudeSpan = Math.abs(box[1][0] - box[0][0]);
    const longitudeSpan = Math.abs(box[1][1] - box[0][1]);
    if (latitudeSpan === 0 || longitudeSpan === 0) {
      context.addIssue({
        code: 'custom',
        message: 'AIS bounding box must cover a non-zero area.',
      });
    }
    if (
      latitudeSpan > MAX_BBOX_SPAN_DEGREES ||
      longitudeSpan > MAX_BBOX_SPAN_DEGREES
    ) {
      context.addIssue({
        code: 'custom',
        message: `AIS bounding box must stay within ${MAX_BBOX_SPAN_DEGREES} degrees per axis.`,
      });
    }
  });

const aisRequestSchema = z
  .object({
    boundingBox: boundingBoxSchema,
    mmsi: z.array(z.string().regex(/^\d{9}$/)).max(200).optional(),
    messageTypes: z.array(messageTypeSchema).min(1).max(2).optional(),
    maxMessages: z.number().int().min(1).max(200).optional(),
  })
  .strict();

const metadataSchema = z
  .object({
    MMSI: z.number().int().nonnegative().optional(),
    MMSI_String: z.string().regex(/^\d{9}$/).optional(),
    ShipName: z.string().max(128).optional(),
    Latitude: finiteNumber.min(-90).max(90).optional(),
    Longitude: finiteNumber.min(-180).max(180).optional(),
    latitude: finiteNumber.min(-90).max(90).optional(),
    longitude: finiteNumber.min(-180).max(180).optional(),
    time_utc: z.string().max(64).optional(),
  })
  .strict();

const positionReportSchema = z
  .object({
    MessageID: z.number().int(),
    RepeatIndicator: z.number().int(),
    UserID: z.number().int().nonnegative(),
    Valid: z.boolean(),
    NavigationalStatus: z.number().int(),
    RateOfTurn: z.number().int(),
    Sog: finiteNumber,
    PositionAccuracy: z.boolean(),
    Longitude: finiteNumber.min(-180).max(180),
    Latitude: finiteNumber.min(-90).max(90),
    Cog: finiteNumber,
    TrueHeading: z.number().int(),
    Timestamp: z.number().int(),
    SpecialManoeuvreIndicator: z.number().int(),
    Spare: z.number().int(),
    Raim: z.boolean(),
    CommunicationState: z.number().int(),
  })
  .strict();

const dimensionSchema = z
  .object({
    A: z.number().int().nonnegative(),
    B: z.number().int().nonnegative(),
    C: z.number().int().nonnegative(),
    D: z.number().int().nonnegative(),
  })
  .strict();

const etaSchema = z
  .object({
    Month: z.number().int().min(0).max(12),
    Day: z.number().int().min(0).max(31),
    Hour: z.number().int().min(0).max(24),
    Minute: z.number().int().min(0).max(60),
  })
  .strict();

const shipStaticDataSchema = z
  .object({
    MessageID: z.number().int(),
    RepeatIndicator: z.number().int(),
    UserID: z.number().int().nonnegative(),
    Valid: z.boolean(),
    AisVersion: z.number().int(),
    ImoNumber: z.number().int().nonnegative(),
    CallSign: z.string().max(32),
    Name: z.string().max(128),
    Type: z.number().int(),
    Dimension: dimensionSchema,
    FixType: z.number().int(),
    Eta: etaSchema,
    MaximumStaticDraught: finiteNumber.nonnegative(),
    Destination: z.string().max(128),
    Dte: z.boolean(),
    Spare: z.boolean(),
  })
  .strict();

const positionEnvelopeSchema = z
  .object({
    MessageType: z.literal('PositionReport'),
    MetaData: metadataSchema,
    Message: z.object({ PositionReport: positionReportSchema }).strict(),
  })
  .strict();

const staticEnvelopeSchema = z
  .object({
    MessageType: z.literal('ShipStaticData'),
    MetaData: metadataSchema,
    Message: z.object({ ShipStaticData: shipStaticDataSchema }).strict(),
  })
  .strict();

const subscriptionConfirmationSchema = z
  .object({
    MessageType: z.literal('SubscriptionConfirmation'),
    Message: z.object({ CompressionEnabled: z.boolean() }).strict(),
  })
  .strict();

const aisEnvelopeSchema = z.union([
  positionEnvelopeSchema,
  staticEnvelopeSchema,
  subscriptionConfirmationSchema,
]);

export type AISStreamRequest = z.input<typeof aisRequestSchema>;
export type AISStreamMessageType = z.infer<typeof messageTypeSchema>;

export type AISPositionObservation = {
  kind: 'position';
  mmsi: string;
  shipName: string | null;
  latitude: number;
  longitude: number;
  speedOverGroundKnots: number;
  courseOverGroundDegrees: number;
  trueHeadingDegrees: number;
  navigationalStatus: number;
  positionAccurate: boolean;
  receivedAt: string;
};

export type AISStaticObservation = {
  kind: 'static';
  mmsi: string;
  imoNumber: number | null;
  callSign: string | null;
  name: string | null;
  vesselType: number;
  destination: string | null;
  eta: { month: number; day: number; hour: number; minute: number };
  draughtMeters: number;
  receivedAt: string;
};

export type AISStreamObservation = AISPositionObservation | AISStaticObservation;

export type AISStreamContext = {
  subscription: {
    boundingBox: [[number, number], [number, number]];
    mmsi: string[];
    messageTypes: AISStreamMessageType[];
  };
  subscriptionConfirmed: boolean;
  compressionEnabled: boolean | null;
  observations: AISStreamObservation[];
  invalidFrames: number;
  sourceUrl: string;
};

export type AISStreamEnvelope = Omit<ConnectorEnvelope<AISStreamContext>, 'connector'> & {
  connector: 'AISSTREAM';
};

type SocketEvent = { data?: unknown };

export type AISStreamWebSocket = {
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: SocketEvent) => void,
  ): void;
  removeEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: SocketEvent) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type AISStreamOptions = {
  apiKey?: string;
  webSocketFactory?: (url: string) => AISStreamWebSocket;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  now?: () => number;
};

function clampedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value as number)));
}

function defaultWebSocketFactory(url: string): AISStreamWebSocket {
  const WebSocketConstructor = globalThis.WebSocket as unknown as
    | (new (target: string) => AISStreamWebSocket)
    | undefined;
  if (!WebSocketConstructor) throw new Error('Server WebSocket support is unavailable.');
  return new WebSocketConstructor(url);
}

function configuredApiKey(explicitKey: string | undefined) {
  const environmentKey =
    typeof process === 'undefined' ? undefined : process.env.AISSTREAM_API_KEY;
  const value = explicitKey ?? environmentKey;
  return value?.trim() || null;
}

function unavailableEnvelope(now: () => number, note: string): AISStreamEnvelope {
  return {
    connector: 'AISSTREAM',
    classification: 'UNKNOWN',
    status: 'unavailable',
    fetchedAt: new Date(now()).toISOString(),
    data: null,
    publicNote: note,
  };
}

function boundedFrameText(data: unknown, maxBytes: number): Promise<string> {
  if (typeof data === 'string') {
    if (new TextEncoder().encode(data).byteLength > maxBytes) {
      return Promise.reject(new Error('AISStream frame exceeded the bounded payload limit.'));
    }
    return Promise.resolve(data);
  }

  if (data instanceof ArrayBuffer) {
    if (data.byteLength > maxBytes) {
      return Promise.reject(new Error('AISStream frame exceeded the bounded payload limit.'));
    }
    return Promise.resolve(new TextDecoder().decode(data));
  }

  if (ArrayBuffer.isView(data)) {
    if (data.byteLength > maxBytes) {
      return Promise.reject(new Error('AISStream frame exceeded the bounded payload limit.'));
    }
    return Promise.resolve(
      new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
    );
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    if (data.size > maxBytes) {
      return Promise.reject(new Error('AISStream frame exceeded the bounded payload limit.'));
    }
    return data.text();
  }

  return Promise.reject(new Error('AISStream returned an unsupported frame type.'));
}

function cleanText(value: string | undefined, limit: number) {
  const cleaned = value?.replace(/[<>]/g, '').trim();
  return cleaned ? cleaned.slice(0, limit) : null;
}

function normalizeObservation(
  envelope: z.infer<typeof positionEnvelopeSchema> | z.infer<typeof staticEnvelopeSchema>,
  receivedAt: string,
): AISStreamObservation {
  if (envelope.MessageType === 'PositionReport') {
    const position = envelope.Message.PositionReport;
    return {
      kind: 'position',
      mmsi: String(position.UserID).padStart(9, '0'),
      shipName: cleanText(envelope.MetaData.ShipName, 128),
      latitude: position.Latitude,
      longitude: position.Longitude,
      speedOverGroundKnots: position.Sog,
      courseOverGroundDegrees: position.Cog,
      trueHeadingDegrees: position.TrueHeading,
      navigationalStatus: position.NavigationalStatus,
      positionAccurate: position.PositionAccuracy,
      receivedAt,
    };
  }

  const staticData = envelope.Message.ShipStaticData;
  return {
    kind: 'static',
    mmsi: String(staticData.UserID).padStart(9, '0'),
    imoNumber: staticData.ImoNumber > 0 ? staticData.ImoNumber : null,
    callSign: cleanText(staticData.CallSign, 32),
    name: cleanText(staticData.Name, 128),
    vesselType: staticData.Type,
    destination: cleanText(staticData.Destination, 128),
    eta: {
      month: staticData.Eta.Month,
      day: staticData.Eta.Day,
      hour: staticData.Eta.Hour,
      minute: staticData.Eta.Minute,
    },
    draughtMeters: staticData.MaximumStaticDraught,
    receivedAt,
  };
}

export async function collectAISStream(
  input: AISStreamRequest,
  options: AISStreamOptions = {},
): Promise<AISStreamEnvelope> {
  const request = aisRequestSchema.parse(input);
  const now = options.now ?? Date.now;
  const apiKey = configuredApiKey(options.apiKey);
  if (!apiKey) {
    return unavailableEnvelope(
      now,
      'AISStream is unavailable because the server-side AISSTREAM_API_KEY is not configured.',
    );
  }
  if (typeof window !== 'undefined') {
    return unavailableEnvelope(
      now,
      'AISStream connections are server-only. No browser connection or API key exposure was attempted.',
    );
  }

  const timeoutMs = clampedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 15_000);
  const maxMessages = request.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxBytes = clampedInteger(options.maxBytes, DEFAULT_MAX_BYTES, 1_024, 512 * 1024);
  const messageTypes = request.messageTypes ?? ['PositionReport', 'ShipStaticData'];
  const mmsi = request.mmsi ?? [];
  const socketFactory = options.webSocketFactory ?? defaultWebSocketFactory;

  return new Promise<AISStreamEnvelope>((resolve) => {
    let socket: AISStreamWebSocket;
    try {
      socket = socketFactory(AISSTREAM_URL);
    } catch {
      resolve(
        unavailableEnvelope(now, 'AISStream could not open a server-side WebSocket connection.'),
      );
      return;
    }

    let settled = false;
    let subscriptionConfirmed = false;
    let compressionEnabled: boolean | null = null;
    let invalidFrames = 0;
    let totalBytes = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let pendingFrames = 0;
    let deferredFinish: { reason?: string } | null = null;
    const observations: AISStreamObservation[] = [];

    const removeListeners = () => {
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const finish = (reason?: string) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      removeListeners();
      try {
        socket.close(1000, 'RouteShift bounded collection complete');
      } catch {
        // The socket may already be closed. No provider detail is exposed.
      }

      const fetchedAt = new Date(now()).toISOString();
      if (observations.length === 0) {
        resolve(
          unavailableEnvelope(
            now,
            reason ??
              'AISStream returned no validated vessel observations before the bounded collection ended.',
          ),
        );
        return;
      }

      resolve({
        connector: 'AISSTREAM',
        classification: 'LIVE_CURRENT_CONTEXT',
        status: 'available',
        fetchedAt,
        expiresAt: new Date(now() + LIVE_TTL_MS).toISOString(),
        data: {
          subscription: {
            boundingBox: request.boundingBox,
            mmsi: [...mmsi],
            messageTypes: [...messageTypes],
          },
          subscriptionConfirmed,
          compressionEnabled,
          observations: [...observations],
          invalidFrames,
          sourceUrl: AISSTREAM_URL,
        },
        publicNote:
          'Current AIS observations from AISStream. A vessel observation does not prove that a RouteShift order is aboard that vessel unless a real booking identifier is independently matched.',
      });
    };

    const requestFinish = (reason?: string) => {
      if (settled) return;
      if (pendingFrames > 0) {
        deferredFinish = { reason };
        return;
      }
      finish(reason);
    };

    const onOpen = () => {
      if (settled) return;
      try {
        const subscription: {
          APIKey: string;
          BoundingBoxes: [typeof request.boundingBox];
          FiltersShipMMSI?: string[];
          FilterMessageTypes: AISStreamMessageType[];
        } = {
          APIKey: apiKey,
          BoundingBoxes: [request.boundingBox],
          FilterMessageTypes: [...messageTypes],
        };
        if (mmsi.length > 0) subscription.FiltersShipMMSI = [...mmsi];
        socket.send(JSON.stringify(subscription));
      } catch {
        requestFinish('AISStream rejected the bounded subscription before collection began.');
      }
    };

    const onMessage = (event: SocketEvent) => {
      if (settled) return;
      pendingFrames += 1;
      void boundedFrameText(event.data, Math.min(maxBytes, MAX_FRAME_BYTES))
        .then((text) => {
          if (settled) return;
          const bytes = new TextEncoder().encode(text).byteLength;
          totalBytes += bytes;
          if (totalBytes > maxBytes) {
            requestFinish('AISStream exceeded the bounded collection payload limit.');
            return;
          }

          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(text);
          } catch {
            invalidFrames += 1;
            return;
          }
          const parsed = aisEnvelopeSchema.safeParse(parsedJson);
          if (!parsed.success) {
            invalidFrames += 1;
            return;
          }
          if (parsed.data.MessageType === 'SubscriptionConfirmation') {
            subscriptionConfirmed = true;
            compressionEnabled = parsed.data.Message.CompressionEnabled;
            return;
          }

          if (observations.length < maxMessages) {
            observations.push(normalizeObservation(parsed.data, new Date(now()).toISOString()));
          }
          if (observations.length >= maxMessages) requestFinish();
        })
        .catch(() => {
          invalidFrames += 1;
          requestFinish('AISStream returned an invalid or oversized frame.');
        })
        .finally(() => {
          pendingFrames -= 1;
          if (pendingFrames === 0 && deferredFinish) {
            const { reason } = deferredFinish;
            deferredFinish = null;
            finish(reason);
          }
        });
    };

    const onError = () => {
      requestFinish('AISStream encountered a connection error before live context was available.');
    };
    const onClose = () => {
      requestFinish('AISStream closed before live context was available.');
    };
    const onAbort = () => {
      requestFinish('AISStream collection was cancelled before live context was available.');
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    if (!settled) {
      timeout = setTimeout(
        () =>
          requestFinish('AISStream returned no validated vessel observations before timeout.'),
        timeoutMs,
      );
    }
  });
}
