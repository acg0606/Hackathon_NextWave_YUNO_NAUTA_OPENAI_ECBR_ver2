'use client';

import Image from 'next/image';
import {
  AlertTriangle,
  ArrowRight,
  Database,
  Layers3,
  LoaderCircle,
  Network,
  Newspaper,
  Radio,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import airInstrumentGhost from '../../assets/plates/air-instrument-ghost.png';
import stageEnvironment from '../../assets/plates/stage-environment.png';
import { LiveEarth, type Coordinates, type RoutePointViewModel, type RouteViewModel } from '@/app/LiveEarth';
import type { Scenario } from '@/app/scenarios';
import { buildHistoricalReplaySeed } from '@/lib/demo/historical-replay';
import {
  appendRunEvent,
  eventsForRun,
  type RunEventCache,
} from '@/lib/runtime/client-event-cache';
import {
  RUN_EVENT_TYPES,
  type AllowedAction,
  type FlowDefinition,
  type JsonObject,
  type JsonValue,
  type RunEvent,
  type RunSnapshot,
  type RunStatus,
  type TruthClassification,
} from '@/lib/runtime/contracts';
import { FlowGraph } from './FlowGraph';
import { FlowMutationLab, type FlowMutationRequest } from './FlowMutationLab';
import { ArchitecturePanel } from './ArchitecturePanel';
import { HistoricalScenarioArchive } from './HistoricalScenarioArchive';
import type { HistoricalScenarioArchiveProps } from './HistoricalScenarioArchive';
import { IntegrationStatusPanel } from './IntegrationStatusPanel';
import { PublicEventFeed, type RuntimeConnectionState } from './PublicEventFeed';
import {
  RunSelector,
  type DemoRunPreset,
  type OrderConfiguration,
  type RuntimeRunSummary,
} from './RunSelector';
import { RuntimeRenderer } from './RuntimeRenderer';
import type { RuntimeActionContext } from './runtime-primitives';

type RunListItem = {
  runId: string;
  label: string;
  flowId: string;
  flowVersion: number;
  status: RunStatus;
  revision: number;
  currentStepId: string | null;
  updatedAt: string;
};

type RunListResponse = {
  persistence: 'D1_DURABLE' | 'IN_MEMORY_NON_DURABLE';
  singleProcess: boolean;
  runs: RunListItem[];
};

type RunResponse = {
  runId: string;
  label: string;
  status: RunStatus;
  revision: number;
  flowVersion: number;
  eventsUrl: string;
  snapshot: RunSnapshot;
  flow: FlowDefinition;
  persistence?: 'D1_DURABLE' | 'IN_MEMORY_NON_DURABLE';
  mutation?: { operation: string; insertedStepId: string; title: string };
  climax?: string;
  agentExecution?: {
    providerId: string;
    providerMode: 'live' | 'deterministic_fallback';
    structuredOutput: boolean;
    model?: string;
    fallbackReason?: string;
    providerStatus?: number;
  };
};

type ApiErrorBody = { error?: { message?: string } };

type ReplayFeedback = HistoricalScenarioArchiveProps['replayFeedback'];

const fallbackRoute: RouteViewModel = {
  id: 'routeshift-default-route',
  origin: { id: 'origin-shanghai', label: 'Shanghai', coordinates: [121.4737, 31.2304] },
  waypoints: [{ id: 'waypoint-iskenderun', label: 'Iskenderun', coordinates: [36.17, 36.58] }],
  destination: { id: 'destination-gaziantep', label: 'Gaziantep', coordinates: [37.3781, 37.0662] },
  state: 'planned',
  accent: '#7c9fff',
  editable: false,
  attribution: 'NASA GIBS · approximate operational route',
};

const locationCoordinates: Record<string, Coordinates> = {
  shanghai: [121.4737, 31.2304],
  xangai: [121.4737, 31.2304],
  gaziantep: [37.3781, 37.0662],
  iskenderun: [36.17, 36.58],
  mersin: [34.6415, 36.8121],
  singapore: [103.8198, 1.3521],
  frankfurt: [8.5706, 50.0333],
  atlanta: [-84.4277, 33.6407],
  london: [-0.4543, 51.47],
  rotterdam: [4.4777, 51.9244],
  santos: [-46.3289, -23.9618],
  'suez canal': [32.5498, 30.015],
  suez: [32.5498, 30.015],
  'cape of good hope': [18.47, -34.36],
  baltimore: [-76.6122, 39.2904],
  norfolk: [-76.2859, 36.8508],
  dubai: [55.3644, 25.2532],
  doha: [51.6081, 25.2731],
  vancouver: [-123.1207, 49.2827],
  'prince rupert': [-130.3208, 54.315],
  seattle: [-122.3321, 47.6062],
  halifax: [-63.5752, 44.6488],
  savannah: [-81.0998, 32.0835],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonRecord(value: JsonValue | undefined): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeLocationKey(label: string) {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(port|airport|terminal|by road|ocean)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coordinatesForLabel(label: string, fallback: Coordinates): Coordinates {
  const normalized = normalizeLocationKey(label);
  const exact = locationCoordinates[normalized];
  if (exact) return exact;
  const partial = Object.entries(locationCoordinates).find(([key]) => normalized.includes(key) || key.includes(normalized));
  return partial?.[1] ?? fallback;
}

function validCoordinates(value: unknown): value is Coordinates {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && Number.isFinite(value[0])
    && typeof value[1] === 'number'
    && Number.isFinite(value[1]);
}

function pointFromValue(value: unknown, id: string, fallbackLabel: string, fallbackCoordinates: Coordinates): RoutePointViewModel {
  if (typeof value === 'string') {
    return { id, label: value, coordinates: coordinatesForLabel(value, fallbackCoordinates) };
  }
  const object = isRecord(value) ? value : {};
  const labelValue = object.label ?? object.name ?? object.location ?? object.code;
  const label = typeof labelValue === 'string' && labelValue.trim() ? labelValue : fallbackLabel;
  const coordinates = validCoordinates(object.coordinates) ? object.coordinates : coordinatesForLabel(label, fallbackCoordinates);
  return { id, label, coordinates };
}

function routeState(snapshot: RunSnapshot, emittedState: unknown): RouteViewModel['state'] {
  const state = typeof emittedState === 'string' ? emittedState.toLowerCase() : '';
  if (state.includes('deliver')) return 'delivered';
  if (state.includes('rerout')) return 'rerouted';
  if (state.includes('hold')) return 'held';
  if (snapshot.status === 'awaiting_human' || state.includes('disrupt') || state.includes('transship')) return 'disrupted';
  if (
    state.includes('transit') ||
    state.includes('running') ||
    snapshot.currentStepId?.includes('monitor') ||
    snapshot.latestUISpec?.layout === 'timeline'
  ) return 'in-transit';
  if (state.includes('draft')) return 'draft';
  if (state.includes('plan') || state.includes('queue')) return 'planned';
  if (snapshot.status === 'completed') return 'planned';
  return 'unknown';
}

function routeModelFromSnapshot(snapshot: RunSnapshot | null): RouteViewModel {
  if (!snapshot) return fallbackRoute;
  const routeSection = snapshot.latestUISpec?.sections.find((section) => section.type === 'route-map');
  const data = routeSection ? jsonRecord(routeSection.data) : {};
  const shipmentArtifact = Object.values(snapshot.artifacts).find((artifact) => (
    artifact.kind.toLowerCase().includes('shipment') || artifact.kind.toLowerCase().includes('route')
  ));
  const shipment = jsonRecord(shipmentArtifact?.value);
  const originValue = data.origin ?? shipment.origin;
  const destinationValue = data.destination ?? (
    validCoordinates(shipment.destinationCoordinates)
      ? { label: shipment.destination ?? 'Selected destination', coordinates: shipment.destinationCoordinates }
      : shipment.destination
  );
  const origin = pointFromValue(originValue, 'origin', 'Shanghai', fallbackRoute.origin.coordinates);
  const destination = pointFromValue(destinationValue, 'destination', 'Gaziantep', fallbackRoute.destination.coordinates);
  const rawWaypoints = Array.isArray(data.waypoints)
    ? data.waypoints
    : Array.isArray(shipment.route)
      ? shipment.route.slice(1, -1)
      : [];
  const waypoints = rawWaypoints.map((value, index) => pointFromValue(
    value,
    `waypoint-${index + 1}`,
    `Waypoint ${index + 1}`,
    index === rawWaypoints.length - 1 ? destination.coordinates : [34.6415, 36.8121],
  ));
  const eventValue = data.event ?? shipment.event ?? shipment.disruption;
  const hasEvent = typeof eventValue === 'string'
    ? !['', 'NONE', 'NO_DISRUPTION'].includes(eventValue.toUpperCase())
    : Boolean(eventValue);
  const eventFallback = waypoints.at(-1)?.coordinates ?? [36.17, 36.58];
  const event = hasEvent
    ? pointFromValue(eventValue, 'disruption', typeof eventValue === 'string' ? eventValue : 'Operational disruption', eventFallback)
    : undefined;
  const liveTransport = jsonRecord(snapshot.artifacts.liveTransportContext?.value);
  const liveObservations = Array.isArray(liveTransport.observations)
    ? liveTransport.observations
    : [];
  const traffic = liveObservations.slice(0, 12).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const longitude = item.longitude;
    const latitude = item.latitude;
    if (
      typeof longitude !== 'number' ||
      typeof latitude !== 'number' ||
      !validCoordinates([longitude, latitude])
    ) return [];
    const rawIdentifier = item.mmsi ?? item.hex;
    const identifier = typeof rawIdentifier === 'string' || typeof rawIdentifier === 'number'
      ? rawIdentifier
      : `traffic-${index + 1}`;
    const label = item.shipName ?? item.name ?? item.callsign ?? item.registration ?? identifier;
    return [{
      id: `live-${String(identifier).replace(/[^A-Za-z0-9_-]/g, '-')}`,
      label: typeof label === 'string' ? label : `Traffic ${index + 1}`,
      coordinates: [longitude, latitude] as Coordinates,
    }];
  });
  const state = routeState(snapshot, data.state ?? shipment.state ?? shipment.disruption);
  return {
    id: `${snapshot.runId}-${snapshot.revision}`,
    origin,
    destination,
    waypoints,
    event,
    traffic,
    focusCoordinates: event?.coordinates ?? waypoints.at(-1)?.coordinates ?? destination.coordinates,
    state,
    accent: snapshot.latestUISpec?.priority === 'critical'
      ? '#ff6f8f'
      : state === 'rerouted' || state === 'delivered'
        ? '#66d3a3'
        : '#ffb000',
    editable: data.editable === true && snapshot.status === 'queued',
    attribution: 'NASA GIBS · route generated from the current run snapshot',
  };
}

function stageName(snapshot: RunSnapshot | null) {
  if (!snapshot) return 'Runtime boot';
  if (snapshot.status === 'awaiting_human') return 'Human checkpoint';
  if (snapshot.status === 'completed') {
    if (snapshot.latestUISpec?.layout === 'receipt') return 'Operation reconciled';
    if (snapshot.latestUISpec?.layout === 'timeline') return 'Shipment checkpoint ready';
    return 'Workflow checkpoint ready';
  }
  const step = snapshot.currentStepId?.replace(/[._-]+/g, ' ');
  return step ? step.replace(/\b\w/g, (letter) => letter.toUpperCase()) : snapshot.status;
}

function sceneClass(snapshot: RunSnapshot | null) {
  const spec = snapshot?.latestUISpec;
  if (!snapshot || !spec) return 'runtime-scene--boot';
  if (spec.layout === 'receipt') return 'runtime-scene--delivered';
  if (snapshot.status === 'awaiting_human' || spec.ownership === 'human') return 'runtime-scene--decision';
  if (spec.priority === 'critical' || spec.priority === 'high') return 'runtime-scene--incident';
  if (spec.layout === 'timeline') return 'runtime-scene--transit';
  return 'runtime-scene--operation';
}

async function apiJson<T>(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  const timeout = window.setTimeout(() => controller.abort('RouteShift request timeout'), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json() as T & ApiErrorBody;
    if (!response.ok) throw new Error(body.error?.message ?? `RouteShift request failed with HTTP ${response.status}.`);
    return body;
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error('The runtime took too long to respond. Check the connection and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

function asRunSummary(item: RunListItem, flow?: FlowDefinition | null): RuntimeRunSummary {
  return {
    runId: item.runId,
    name: item.label,
    status: item.status,
    revision: item.revision,
    currentStepTitle: flow?.steps.find((step) => step.id === item.currentStepId)?.title
      ?? item.currentStepId?.replace(/[._-]+/g, ' '),
  };
}

function upsertRunList(items: RunListItem[], response: RunResponse): RunListItem[] {
  const next: RunListItem = {
    runId: response.runId,
    label: response.label,
    flowId: response.snapshot.flowId,
    flowVersion: response.flowVersion,
    status: response.status,
    revision: response.revision,
    currentStepId: response.snapshot.currentStepId,
    updatedAt: response.snapshot.timestamps.updatedAt,
  };
  return [next, ...items.filter((item) => item.runId !== response.runId)];
}

function eventEvidenceSupportsRecomposition(events: RunEvent[]) {
  const flowChangeIndex = events.findIndex((event) => event.type === 'flow.definition.updated');
  if (flowChangeIndex < 0) return false;
  const eventsAfterChange = events.slice(flowChangeIndex);
  return eventsAfterChange.some((event) => event.type === 'step.discovered')
    && eventsAfterChange.some((event) => event.type === 'ui.spec.emitted');
}

function orderSeed(configuration: OrderConfiguration): JsonObject {
  const portOfDischarge = configuration.destination === 'Gaziantep'
    ? 'TRISK'
    : configuration.destination === 'Rotterdam'
      ? 'NLRTM'
      : 'USATL';
  const distanceKm = configuration.destination === 'Gaziantep'
    ? 9_250
    : configuration.destination === 'Rotterdam'
      ? 10_500
      : 12_000;
  const maritime = configuration.transportMode !== 'AIR';
  return {
    shipment: {
      orderId: `RS-ORDER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      scenarioId: 'CUSTOM_ORDER',
      transportMode: configuration.transportMode,
      origin: 'Shanghai',
      destination: configuration.destination,
      destinationCoordinates: configuration.destinationCoordinates,
      disruption: 'NONE',
      route: ['Shanghai', configuration.destination],
      distanceKm,
      promiseDays: configuration.promiseDays,
    },
    order: {
      customer: 'Muebles del Sur',
      product: configuration.product,
      productValueUsd: configuration.productValueUsd,
      packageCount: 24,
    },
    externalActions: {
      yunoSandbox: configuration.useYunoSandbox,
      authorizedBy: 'buy-delivery-form',
      classification: 'SIMULATED_IF_TODAY',
    },
    booking: {
      bookingNumber: 'BKG-NW26-014',
      containerNumber: maritime ? 'MSCU0142026' : 'AIR-NW26014',
      portOfLoading: maritime ? 'CNSHA' : 'PVG',
      portOfDischarge,
      grossWeightKg: 18_240,
      packageCount: 24,
    },
    billOfLading: {
      billNumber: maritime ? 'MAEU-NW26-014' : 'AIRWAY-NW26-014',
      bookingNumber: 'BKG-NW26-014',
      containerNumber: maritime ? 'MSCU0142026' : 'AIR-NW26014',
      portOfLoading: maritime ? 'CNSHA' : 'PVG',
      portOfDischarge: configuration.destination === 'Gaziantep' && maritime ? 'TRMER' : portOfDischarge,
      grossWeightKg: configuration.destination === 'Gaziantep' && maritime ? 19_050 : 18_240,
      packageCount: 24,
    },
  };
}

function Brand() {
  return (
    <div className="brand-lockup" aria-label="RouteShift by JAIGO">
      <span>ROUTE<span>SHIFT</span></span>
      <small>by JAIGO</small>
    </div>
  );
}

export function RouteShiftRuntime() {
  const [runItems, setRunItems] = useState<RunListItem[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [flow, setFlow] = useState<FlowDefinition | null>(null);
  const [eventsByRunId, setEventsByRunId] = useState<RunEventCache>({});
  const [connection, setConnection] = useState<RuntimeConnectionState>('connecting');
  const [runtimePersistence, setRuntimePersistence] = useState<'D1_DURABLE' | 'IN_MEMORY_NON_DURABLE'>('IN_MEMORY_NON_DURABLE');
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mutationState, setMutationState] = useState<'idle' | 'submitting' | 'accepted' | 'error'>('idle');
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [busyPreset, setBusyPreset] = useState<string | null>(null);
  const [replayFeedback, setReplayFeedback] = useState<ReplayFeedback>({ state: 'idle' });
  const [replayNotice, setReplayNotice] = useState<{ scenarioName: string; runId: string } | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [runSelectorOpen, setRunSelectorOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreArchiveFocus, setRestoreArchiveFocus] = useState(true);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [architectureOpen, setArchitectureOpen] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const activeRunIdRef = useRef<string | null>(null);
  const lastSequenceRef = useRef(0);
  const lastSequenceByRunRef = useRef<Record<string, number>>({});
  const refreshTimerRef = useRef<number | null>(null);
  const busyScenarioRef = useRef<string | null>(null);
  const events = eventsForRun(eventsByRunId, activeRunId);

  const activateRun = useCallback((runId: string) => {
    const changed = activeRunIdRef.current !== runId;
    activeRunIdRef.current = runId;
    if (changed) {
      setConnection('connecting');
      setFatalError(null);
      setActionError(null);
      setPendingActionId(null);
      setMutationState('idle');
      setMutationMessage(null);
    }
    setActiveRunId(runId);
  }, []);

  const fetchRun = useCallback(async (runId: string) => {
    const response = await apiJson<RunResponse>(`/api/runs/${encodeURIComponent(runId)}`);
    if (activeRunIdRef.current === runId) {
      setSnapshot(response.snapshot);
      setFlow(response.flow);
      if (response.persistence) setRuntimePersistence(response.persistence);
    }
    setRunItems((current) => upsertRunList(current, response));
    return response;
  }, []);

  const loadRunList = useCallback(async () => {
    const response = await apiJson<RunListResponse>('/api/runs');
    setRunItems(response.runs);
    setRuntimePersistence(response.persistence);
    const current = activeRunIdRef.current;
    const next = current && response.runs.some((run) => run.runId === current)
        ? current
        : response.runs.find((run) => run.label.startsWith('Run 1 — Booking preparation'))?.runId
          ?? response.runs[0]?.runId
          ?? null;
    if (next) activateRun(next);
  }, [activateRun]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void loadRunList()
        .catch((error: unknown) => {
          if (active) setFatalError(error instanceof Error ? error.message : 'The runtime could not load its runs.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loadRunList]);

  useEffect(() => {
    if (!activeRunId) return;
    let active = true;
    lastSequenceRef.current = lastSequenceByRunRef.current[activeRunId] ?? 0;
    const timer = window.setTimeout(() => {
      void fetchRun(activeRunId)
        .catch((error: unknown) => {
          if (active) setFatalError(error instanceof Error ? error.message : 'The selected run is unavailable.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeRunId, fetchRun]);

  useEffect(() => {
    if (!activeRunId) return;
    const runId = activeRunId;
    let alive = true;
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after=${lastSequenceRef.current}`);

    function scheduleSnapshotRefresh() {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        void fetchRun(runId).catch(() => {
          if (alive && activeRunIdRef.current === runId) setConnection('reconnecting');
        });
      }, 70);
    }

    function receive(message: MessageEvent<string>) {
      if (!alive) return;
      try {
        const event = JSON.parse(message.data) as RunEvent;
        if (event.runId !== runId || !RUN_EVENT_TYPES.includes(event.type)) return;
        const previousSequence = lastSequenceRef.current;
        if (event.sequence <= previousSequence) return;
        if (previousSequence > 0 && event.sequence !== previousSequence + 1) {
          source.close();
          setConnection('reconnecting');
          void fetchRun(runId)
            .then(() => {
              if (alive && activeRunIdRef.current === runId) {
                setStreamEpoch((current) => current + 1);
              }
            })
            .catch(() => {
              if (alive && activeRunIdRef.current === runId) setConnection('offline');
            });
          return;
        }
        lastSequenceRef.current = event.sequence;
        lastSequenceByRunRef.current[runId] = event.sequence;
        setEventsByRunId((current) => appendRunEvent(current, event));
        scheduleSnapshotRefresh();
      } catch {
        if (alive && activeRunIdRef.current === runId) setConnection('reconnecting');
      }
    }

    source.addEventListener('run-event', receive as EventListener);
    source.onopen = () => {
      if (alive && activeRunIdRef.current === runId) setConnection('live');
    };
    source.onerror = () => {
      if (!alive || activeRunIdRef.current !== runId) return;
      setConnection(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
    };

    return () => {
      alive = false;
      source.removeEventListener('run-event', receive as EventListener);
      source.close();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [activeRunId, fetchRun, streamEpoch]);

  const createRun = useCallback(async (body: JsonObject, busyId: string) => {
    setFatalError(null);
    const response = await apiJson<RunResponse>('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.persistence) setRuntimePersistence(response.persistence);
    setRunItems((current) => upsertRunList(current, response));
    activateRun(response.runId);
    setSnapshot(response.snapshot);
    setFlow(response.flow);
    setEventsByRunId((current) => ({ ...current, [response.runId]: [] }));
    lastSequenceByRunRef.current[response.runId] = 0;
    lastSequenceRef.current = 0;
    return { response, busyId };
  }, [activateRun]);

  const handleCreatePreset = useCallback((preset: DemoRunPreset, configuration?: OrderConfiguration) => {
    setBusyPreset(preset);
    const body: JsonObject = configuration
      ? {
          demoId: preset,
          label: `Muebles del Sur — ${configuration.destination}`,
          seed: orderSeed(configuration),
        }
      : { demoId: preset };
    void createRun(body, preset)
      .then(() => setRunSelectorOpen(false))
      .catch((error: unknown) => setFatalError(error instanceof Error ? error.message : 'The run could not be created.'))
      .finally(() => setBusyPreset(null));
  }, [createRun]);

  const handleReplayScenario = useCallback((scenario: Scenario) => {
    if (busyScenarioRef.current) return;
    busyScenarioRef.current = scenario.id;
    const idempotencyKey = replayFeedback.state === 'error' && replayFeedback.scenarioId === scenario.id
      ? replayFeedback.idempotencyKey
      : crypto.randomUUID();
    setReplayFeedback({
      state: 'creating',
      scenarioId: scenario.id,
      scenarioName: scenario.shortName,
      idempotencyKey,
    });
    setReplayNotice(null);
    void createRun({
      demoId: 'unexpected-transshipment',
      label: `Historical replay — ${scenario.shortName}`,
      idempotencyKey,
      seed: buildHistoricalReplaySeed(scenario),
    }, scenario.id)
      .then(({ response }) => {
        setSelectedScenarioId(scenario.id);
        setReplayFeedback({ state: 'idle' });
        setReplayNotice({ scenarioName: scenario.shortName, runId: response.runId });
        setRestoreArchiveFocus(false);
        setArchiveOpen(false);
      })
      .catch((error: unknown) => setReplayFeedback({
        state: 'error',
        scenarioId: scenario.id,
        scenarioName: scenario.shortName,
        idempotencyKey,
        message: error instanceof Error
          ? `${error.message} Your selection is preserved; try again.`
          : 'The public runtime could not create this replay. Your selection is preserved; try again.',
      }))
      .finally(() => {
        busyScenarioRef.current = null;
      });
  }, [createRun, replayFeedback]);

  const handleAction = useCallback((action: AllowedAction, context?: RuntimeActionContext) => {
    if (!snapshot || !activeRunId) return;
    if (action.requiresConfirmation && !window.confirm(`${action.label}\n\nThis is a mock operation with no external side effect.`)) return;
    const decisionId = context?.decisionId || snapshot.pendingDecision?.decisionId;
    if (!decisionId) {
      setActionError('This action is no longer attached to an active decision. Refresh the run and try again.');
      return;
    }
    setActionError(null);
    setPendingActionId(action.actionId);
    void apiJson<RunResponse>(`/api/runs/${encodeURIComponent(activeRunId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decisionId,
        actionId: action.actionId,
        expectedRevision: snapshot.pendingDecision?.expectedRevision ?? snapshot.revision,
        idempotencyKey: crypto.randomUUID(),
        ...(context?.input ? { input: context.input } : {}),
      }),
    })
      .then((response) => {
        if (response.runId !== activeRunId) throw new Error('The runtime returned a different run. The action was not applied locally.');
        setRunItems((current) => upsertRunList(current, response));
        if (activeRunIdRef.current !== activeRunId) return;
        setSnapshot(response.snapshot);
        setFlow(response.flow);
        if (response.persistence) setRuntimePersistence(response.persistence);
      })
      .catch((error: unknown) => {
        if (activeRunIdRef.current !== activeRunId) return;
        setActionError(error instanceof Error ? error.message : 'The human action could not be submitted.');
        void fetchRun(activeRunId).catch(() => undefined);
      })
      .finally(() => {
        if (activeRunIdRef.current === activeRunId) setPendingActionId(null);
      });
  }, [activeRunId, fetchRun, snapshot]);

  const handleFlowMutation = useCallback((request: FlowMutationRequest) => {
    if (!snapshot || !flow || !activeRunId) return;
    setMutationState('submitting');
    setMutationMessage(null);
    const body = 'instruction' in request
      ? { instruction: request.instruction, expectedFlowVersion: flow.version }
      : isRecord(request.mutation)
        ? { ...request.mutation, expectedFlowVersion: request.mutation.expectedFlowVersion ?? flow.version }
        : request.mutation;
    void apiJson<RunResponse>(`/api/runs/${encodeURIComponent(activeRunId)}/flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((response) => {
        if (response.runId !== activeRunId) throw new Error('The mutation did not return the active run.');
        setRunItems((current) => upsertRunList(current, response));
        if (activeRunIdRef.current !== activeRunId) return;
        setSnapshot(response.snapshot);
        setFlow(response.flow);
        if (response.persistence) setRuntimePersistence(response.persistence);
        setMutationState('accepted');
        const provider = response.agentExecution?.providerMode === 'live'
          ? `OpenAI structured output · ${response.agentExecution.model ?? response.agentExecution.providerId}`
          : `deterministic safe fallback${response.agentExecution?.fallbackReason
            ? ` · ${response.agentExecution.fallbackReason.replaceAll('_', ' ')}`
            : ''}`;
        setMutationMessage(
          `${response.climax ?? `Inserted ${response.mutation?.title ?? 'the new step'} into Flow v${response.flowVersion}.`} · ${provider}`,
        );
      })
      .catch((error: unknown) => {
        if (activeRunIdRef.current !== activeRunId) return;
        setMutationState('error');
        setMutationMessage(error instanceof Error ? error.message : 'The flow mutation was rejected.');
        void fetchRun(activeRunId).catch(() => undefined);
      });
  }, [activeRunId, fetchRun, flow, snapshot]);

  const routeModel = useMemo(() => routeModelFromSnapshot(snapshot), [snapshot]);
  const runSummaries = useMemo(() => runItems.map((item) => asRunSummary(
    item,
    item.runId === activeRunId ? flow : null,
  )), [activeRunId, flow, runItems]);
  const recompositionProof = useMemo(() => eventEvidenceSupportsRecomposition(events), [events]);
  const spec = snapshot?.latestUISpec ?? null;
  const truth = spec?.truthContext ?? (['UNKNOWN'] as TruthClassification[]);

  return (
    <main
      className={`route-site route-runtime ${sceneClass(snapshot)}`}
      style={{ '--scenario-accent': routeModel.accent ?? '#ffb000' } as React.CSSProperties}
    >
      <div className="stage-environment" aria-hidden="true">
        <Image src={stageEnvironment} alt="" fill priority sizes="100vw" />
        <Image className="stage-instrument" src={airInstrumentGhost} alt="" />
      </div>

      <header className="site-header runtime-site-header">
        <Brand />
        <div className="runtime-stage-readout" aria-live="polite">
          <span className="stage-readout__dot" />
          <span>{stageName(snapshot)}</span>
          {snapshot ? <small>{snapshot.status.replace('_', ' ')} · {spec?.ownership ?? 'system'} owner</small> : null}
        </div>
        <div className="runtime-header-actions">
          <button type="button" onClick={() => {
            setRunSelectorOpen((current) => !current);
            setIntegrationOpen(false);
            setArchitectureOpen(false);
          }} aria-expanded={runSelectorOpen}>
            <Layers3 aria-hidden="true" /> Runs <span>{runItems.length}</span>
          </button>
          <button type="button" onClick={() => {
            setRestoreArchiveFocus(true);
            setArchiveOpen(true);
            setRunSelectorOpen(false);
            setIntegrationOpen(false);
            setArchitectureOpen(false);
          }}>
            <Newspaper aria-hidden="true" /> 10 scenarios
          </button>
          <button type="button" onClick={() => {
            setIntegrationOpen((current) => !current);
            setRunSelectorOpen(false);
            setArchitectureOpen(false);
          }} aria-expanded={integrationOpen}>
            <Radio aria-hidden="true" /> Integrations
          </button>
          <button
            type="button"
            onClick={() => {
              setArchitectureOpen((current) => !current);
              setRunSelectorOpen(false);
              setIntegrationOpen(false);
              setArchiveOpen(false);
            }}
            aria-controls="runtime-architecture-panel"
            aria-expanded={architectureOpen}
            aria-haspopup="dialog"
          >
            <Network aria-hidden="true" /> Architecture
          </button>
        </div>
      </header>

      <div className="runtime-truth-legend" aria-label="Truth classifications in this interface">
        {truth.map((classification) => (
          <span key={classification}>{classification.replaceAll('_', ' ')}</span>
        ))}
      </div>

      {runSelectorOpen ? (
        <aside className="runtime-run-drawer" aria-label="Run control">
          <button className="runtime-icon-button runtime-run-drawer__close" type="button" onClick={() => setRunSelectorOpen(false)} aria-label="Close run control"><X /></button>
          <RunSelector
            activeRunId={activeRunId}
            busyPreset={busyPreset}
            onCreate={handleCreatePreset}
            onSelect={(runId) => {
              if (runId === activeRunId) return;
              setSnapshot(null);
              setFlow(null);
              activateRun(runId);
              setRunSelectorOpen(false);
            }}
            runs={runSummaries}
          />
          <footer>
            <Database aria-hidden="true" />
            {runtimePersistence === 'D1_DURABLE'
              ? 'Runs are isolated to this browser session and stored durably.'
              : 'Local preview runs are process-local and non-durable.'}
          </footer>
        </aside>
      ) : null}

      <div className="earth-stage runtime-earth-stage">
        <LiveEarth model={routeModel} />
      </div>

      <section className="runtime-operating-surface" aria-label="Generated operational interface">
        {loading && !spec ? (
          <div className="runtime-loading" aria-live="polite">
            <LoaderCircle aria-hidden="true" />
            <h1>Reconstructing the operation</h1>
            <p>Folding validated events into the current run snapshot.</p>
          </div>
        ) : fatalError && !spec ? (
          <div className="runtime-fatal" role="alert">
            <AlertTriangle aria-hidden="true" />
            <h1>The local runtime is unavailable.</h1>
            <p>{fatalError}</p>
            <button className="runtime-button runtime-button--primary" type="button" onClick={() => { setLoading(true); void loadRunList().finally(() => setLoading(false)); }}>
              Retry local runtime <RefreshCw aria-hidden="true" />
            </button>
          </div>
        ) : spec && snapshot ? (
          <RuntimeRenderer
            currentStepId={snapshot.currentStepId}
            onAction={handleAction}
            pendingActionId={pendingActionId}
            proofOfRecomposition={recompositionProof}
            spec={spec}
          />
        ) : (
          <div className="runtime-empty-state">
            <Sparkles aria-hidden="true" />
            <h1>The flow is ready for its first run.</h1>
            <p>Create a booking operation to begin streaming semantic work.</p>
            <button className="runtime-button runtime-button--primary" type="button" onClick={() => setRunSelectorOpen(true)}>
              Open run control <ArrowRight aria-hidden="true" />
            </button>
          </div>
        )}
        {actionError ? <p className="runtime-global-error" role="alert">{actionError}</p> : null}
      </section>

      {replayNotice ? (
        <output className="runtime-replay-notice" aria-live="polite" aria-atomic="true">
          <div>
            <strong>Replay ready — {replayNotice.scenarioName}</strong>
            <span>Run {replayNotice.runId} is active. The interface has moved to its incident workspace.</span>
          </div>
          <button type="button" onClick={() => setReplayNotice(null)} aria-label="Dismiss replay confirmation"><X aria-hidden="true" /></button>
        </output>
      ) : null}

      {snapshot && flow ? (
        <>
          <FlowMutationLab
            disabled={loading || snapshot.status === 'failed' || snapshot.status === 'cancelled'}
            flowVersion={flow.version}
            message={mutationMessage}
            onMutate={handleFlowMutation}
            runId={snapshot.runId}
            state={mutationState}
          />
          <PublicEventFeed connection={connection} events={events} />
          <FlowGraph flow={flow} snapshot={snapshot} />
        </>
      ) : null}

      <HistoricalScenarioArchive
        replayFeedback={replayFeedback}
        onClose={() => {
          if (replayFeedback.state !== 'creating') setReplayFeedback({ state: 'idle' });
          setArchiveOpen(false);
        }}
        onReplay={handleReplayScenario}
        open={archiveOpen}
        restoreFocusOnClose={restoreArchiveFocus}
        selectedScenarioId={selectedScenarioId}
      />

      <IntegrationStatusPanel
        agentProvider={snapshot?.publicAgentSummary ?? null}
        connectorStates={snapshot?.connectorStates}
        onClose={() => setIntegrationOpen(false)}
        open={integrationOpen}
      />

      <ArchitecturePanel
        onClose={() => setArchitectureOpen(false)}
        open={architectureOpen}
        runtimeProof={snapshot ? {
          runId: snapshot.runId,
          flowVersion: snapshot.flowVersion,
          revision: snapshot.revision,
          status: snapshot.status,
          currentStepId: snapshot.currentStepId,
          owner: spec?.ownership ?? 'system',
        } : null}
      />

      <p className="runtime-announcement sr-only" aria-live="assertive">
        {mutationState === 'accepted' ? mutationMessage : actionError}
      </p>
      <div className="runtime-live-stamp" aria-hidden="true">
        <Radio /> {connection.toUpperCase()} SSE · {runtimePersistence === 'D1_DURABLE' ? 'DURABLE RUN' : 'LOCAL MEMORY'}
      </div>
    </main>
  );
}

export default RouteShiftRuntime;
