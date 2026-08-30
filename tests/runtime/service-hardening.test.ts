import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentProvider,
  PublicAgentSummary,
  SemanticStepIntent,
} from '@/lib/agent/agent-provider';
import { demoAgent } from '@/lib/agent/demo-agent';
import { mergeSemanticStepIntent } from '@/lib/agent/openai-agent';
import { clearEonetCacheForTests } from '@/lib/connectors/nasa-eonet';
import type { FlowDefinition } from '@/lib/runtime/contracts';
import { FlowEngine } from '@/lib/runtime/flow-engine';
import { InMemoryRunStore } from '@/lib/runtime/run-store';

const eonetPayload = JSON.stringify({
  events: [
    {
      id: 'EONET-1',
      title: 'Current tropical storm',
      categories: [{ title: 'Severe Storms' }],
      geometry: [{ date: '2026-08-30T00:00:00Z', coordinates: [-42.5, 18.2] }],
      sources: [{ url: 'https://eonet.gsfc.nasa.gov/' }],
    },
  ],
});

function stubEonet(payload = eonetPayload) {
  clearEonetCacheForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(payload, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
  );
}

afterEach(() => {
  clearEonetCacheForTests();
  vi.unstubAllGlobals();
});

describe('service hardening', () => {
  it('preserves deterministic B/L runtime semantics after a valid model classification', async () => {
    const deterministic = await demoAgent.inferStep(
      'Validate Bill of Lading against booking before confirming.',
    );
    const model: SemanticStepIntent = {
      title: 'Model-classified document check',
      description: 'A valid but intentionally incomplete model classification.',
      kind: 'generic',
      capabilities: ['audit.view'],
      owner: 'system',
      tool: 'agent.classify',
    };

    const merged = mergeSemanticStepIntent(model, deterministic);
    expect(merged.kind).toBe('validate');
    expect(merged.capabilities).toEqual(
      expect.arrayContaining(['document.compare', 'decision.request']),
    );
    expect(merged.condition).toEqual(deterministic?.condition);
    expect(merged.inputRefs).toEqual(deterministic?.inputRefs);
    expect(merged.transitions).toEqual(deterministic?.transitions);
    expect(merged.after).toBe('prepare-booking');
    expect(merged.before).toBe('confirm-booking');
  });

  it('enforces bounded timeout and retry for an advertised agent tool', async () => {
    const neverSummary = new Promise<PublicAgentSummary>(() => {});
    const slowAgent: AgentProvider = {
      id: 'slow-test-agent',
      deterministic: true,
      inferStep: (instruction) => demoAgent.inferStep(instruction),
      compareDocuments: (expected, actual) => demoAgent.compareDocuments(expected, actual),
      summarize: () => neverSummary,
    };
    const flow: FlowDefinition = {
      schemaVersion: '1.0',
      id: 'bounded-tool-flow',
      version: 1,
      name: 'Bounded tool flow',
      description: 'Exercise runtime timeout and retry enforcement.',
      entryStepId: 'bounded-extraction',
      steps: [
        {
          schemaVersion: '1.0',
          id: 'bounded-extraction',
          title: 'Bounded extraction',
          description: 'This deliberately slow test tool must time out.',
          kind: 'extract',
          capabilities: ['audit.view'],
          owner: 'agent',
          tool: { id: 'agent.extract' },
          timeoutMs: 100,
          retry: { maxAttempts: 2, backoffMs: 0 },
        },
      ],
      transitions: [
        { fromStepId: 'bounded-extraction', outcome: 'success', toStepId: null },
      ],
      metadata: { purpose: 'test' },
    };
    const store = new InMemoryRunStore(new FlowEngine(slowAgent));
    const run = await store.createRun({
      flow,
      seed: {
        shipment: { orderId: 'TIMEOUT-1', origin: 'A', destination: 'B' },
        order: { customer: 'Test customer' },
      },
    });

    expect(run.snapshot.status).toBe('failed');
    expect(
      run.events.filter(
        (event) => event.type === 'tool.call.started' && event.stepId === 'bounded-extraction',
      ),
    ).toHaveLength(2);
    expect(
      run.events.filter(
        (event) =>
          event.type === 'tool.call.failed' && event.payload.errorCode === 'STEP_TIMEOUT',
      ),
    ).toHaveLength(2);
  });

  it('adds bounded NASA current context without conflating historical evidence', async () => {
    stubEonet();
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const run = await store.createRun({ demoId: 'unexpected-transshipment' });

    expect(run.snapshot.status).toBe('awaiting_human');
    expect(run.snapshot.connectorStates.NASA_EONET).toMatchObject({
      status: 'available',
      truth: 'LIVE_CURRENT_CONTEXT',
    });
    expect(run.snapshot.artifacts.currentContext).toMatchObject({
      truth: 'LIVE_CURRENT_CONTEXT',
      provenance: {
        classification: 'LIVE_CURRENT_CONTEXT',
        sourceTitle: 'NASA EONET open events',
      },
    });
    expect(JSON.stringify(run.snapshot.artifacts.currentContext.value)).not.toContain('https://');
    expect(run.snapshot.artifacts.historicalEvidence.truth).toBe('HISTORICAL_FACT');
  });

  it('separates RouteShift pricing from Nauta and Yuno payment consequences', async () => {
    stubEonet();
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const rerouteRun = await store.createRun({ demoId: 'unexpected-transshipment' });
    const rerouteDecision = rerouteRun.snapshot.pendingDecision!;
    const rerouted = await store.submitAction(rerouteRun.snapshot.runId, {
      runId: rerouteRun.snapshot.runId,
      decisionId: rerouteDecision.decisionId,
      actionId: 'reroute',
      expectedRevision: rerouteRun.snapshot.revision,
      idempotencyKey: 'hardening-reroute',
    });
    expect(rerouted.snapshot.artifacts.nautaTracking.value).toMatchObject({
      operation: 'REROUTE',
      resolution: 'REROUTED',
    });
    expect(rerouted.snapshot.artifacts.routeQuote.value).toMatchObject({
      operation: 'REQUOTE',
      replacementTicketRequired: true,
    });
    expect(rerouted.snapshot.artifacts.routeQuote.truth).toBe('SIMULATED_IF_TODAY');
    expect(rerouted.snapshot.artifacts.shipment.value).toMatchObject({
      state: 'rerouted',
      transportMode: 'AIR',
    });

    const holdRun = await store.createRun({ demoId: 'unexpected-transshipment' });
    const firstDecision = holdRun.snapshot.pendingDecision!;
    const held = await store.submitAction(holdRun.snapshot.runId, {
      runId: holdRun.snapshot.runId,
      decisionId: firstDecision.decisionId,
      actionId: 'hold',
      expectedRevision: holdRun.snapshot.revision,
      idempotencyKey: 'hardening-hold',
    });
    const releaseDecision = held.snapshot.pendingDecision!;
    const released = await store.submitAction(holdRun.snapshot.runId, {
      runId: holdRun.snapshot.runId,
      decisionId: releaseDecision.decisionId,
      actionId: 'release',
      expectedRevision: held.snapshot.revision,
      idempotencyKey: 'hardening-release',
    });
    expect(released.snapshot.artifacts.nautaTracking.value).toMatchObject({
      operation: 'RELEASE',
      resolution: 'RELEASED',
    });
    expect(released.snapshot.artifacts.yunoQuote.value).toMatchObject({
      operation: 'PAYMENT',
      paymentState: 'APPROVED',
    });
    expect(released.snapshot.artifacts.shipment.value).toMatchObject({
      state: 'released',
    });
  });

  it('drops out-of-range coordinates from bounded EONET payloads', async () => {
    stubEonet(
      JSON.stringify({
        events: [
          {
            id: 'OUT-OF-RANGE',
            title: 'Invalid geometry test',
            categories: [{ title: 'Test' }],
            geometry: [{ date: '2026-08-30T00:00:00Z', coordinates: [999, 95] }],
          },
        ],
      }),
    );
    const { fetchCurrentEonetContext } = await import('@/lib/connectors/nasa-eonet');
    const result = await fetchCurrentEonetContext({ timeoutMs: 500 });
    expect(result.status).toBe('available');
    expect(result.data?.[0]?.coordinates).toBeNull();
  });
});
