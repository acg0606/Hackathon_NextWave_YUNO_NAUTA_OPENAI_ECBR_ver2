import { describe, expect, it } from 'vitest';

import { demoAgent } from '@/lib/agent/demo-agent';
import { FlowEngine } from '@/lib/runtime/flow-engine';
import { inferFlowMutation } from '@/lib/runtime/infer-step-semantics';
import { InMemoryRunStore } from '@/lib/runtime/run-store';

const instruction = 'Validate Bill of Lading against booking before confirming.';

describe('trial by fire', () => {
  it('inserts a random semantic step and resumes the same run after correction', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const created = await store.createRun({ demoId: 'booking-preparation' });
    const runId = created.snapshot.runId;
    const prepareStarted = created.events.findIndex(
      (event) => event.type === 'step.started' && event.stepId === 'prepare-booking',
    );
    const bookingUpserted = created.events.findIndex(
      (event) =>
        event.type === 'artifact.upserted' &&
        (event.payload.artifact as { id?: string } | undefined)?.id === 'booking',
    );
    const billUpserted = created.events.findIndex(
      (event) =>
        event.type === 'artifact.upserted' &&
        (event.payload.artifact as { id?: string } | undefined)?.id === 'billOfLading',
    );
    const prepareCompleted = created.events.findIndex(
      (event) => event.type === 'step.completed' && event.stepId === 'prepare-booking',
    );
    expect(prepareStarted).toBeGreaterThanOrEqual(0);
    expect(bookingUpserted).toBeGreaterThan(prepareStarted);
    expect(billUpserted).toBeGreaterThan(bookingUpserted);
    expect(prepareCompleted).toBeGreaterThan(billUpserted);
    expect(created.snapshot.latestUISpec?.sections.map((section) => section.type)).toEqual([
      'booking',
      'evidence',
      'quote',
    ]);
    expect(
      created.snapshot.latestUISpec?.sections.find((section) => section.title === 'Documents')?.data.items,
    ).toHaveLength(2);
    const mutation = await inferFlowMutation({
      instruction,
      expectedFlowVersion: created.flow.version,
      provider: demoAgent,
    });

    expect(mutation.step.id).toMatch(/^step-/);
    expect(mutation.step.id).not.toBe('validate-bol');

    const paused = await store.mutateFlow(runId, mutation);
    expect(paused.snapshot.runId).toBe(runId);
    expect(paused.snapshot.status).toBe('awaiting_human');
    expect(paused.snapshot.currentStepId).toBe(mutation.step.id);
    expect(paused.snapshot.latestUISpec?.sections.map((section) => section.type)).toContain(
      'document-comparison',
    );
    expect(paused.snapshot.artifacts.documentComparison?.value).toMatchObject({
      matches: false,
      confidence: 0.98,
    });
    expect(JSON.stringify(paused.snapshot.artifacts.documentComparison?.value)).toContain(
      'portOfDischarge',
    );
    expect(JSON.stringify(paused.snapshot.artifacts.documentComparison?.value)).toContain(
      'grossWeightKg',
    );
    expect(
      paused.events.filter(
        (event) =>
          event.stepId === mutation.step.id &&
          event.type === 'tool.call.started' &&
          event.payload.toolId === 'mock.document.compare',
      ),
    ).toHaveLength(1);
    expect(
      paused.events.filter(
        (event) =>
          event.stepId === mutation.step.id &&
          event.type === 'tool.call.completed' &&
          event.payload.toolId === 'mock.document.compare',
      ),
    ).toHaveLength(1);

    const decision = paused.snapshot.pendingDecision;
    expect(decision).not.toBeNull();
    const corrected = await store.submitAction(runId, {
      runId,
      decisionId: decision!.decisionId,
      actionId: 'request-corrected-document',
      expectedRevision: paused.snapshot.revision,
      idempotencyKey: 'trial-correct-014',
    });

    expect(corrected.snapshot.runId).toBe(runId);
    expect(corrected.snapshot.status).toBe('completed');
    expect(corrected.snapshot.artifacts.documentComparison?.value).toMatchObject({
      matches: true,
      confidence: 0.99,
    });
    expect(corrected.events.some((event) => event.type === 'run.resumed')).toBe(true);
    expect(
      corrected.events.some(
        (event) => event.type === 'step.started' && event.stepId === 'confirm-booking',
      ),
    ).toBe(true);
    expect(
      corrected.events.filter(
        (event) =>
          event.stepId === mutation.step.id &&
          event.type === 'tool.call.started' &&
          event.payload.toolId === 'mock.document.compare',
      ),
    ).toHaveLength(2);
    expect(
      corrected.events.filter(
        (event) =>
          event.stepId === mutation.step.id &&
          event.type === 'tool.call.completed' &&
          event.payload.toolId === 'mock.document.compare',
      ),
    ).toHaveLength(2);

    const sequences = corrected.events.map((event) => event.sequence);
    const revisions = corrected.events.map((event) => event.revision);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));

    const duplicate = await store.submitAction(runId, {
      runId,
      decisionId: decision!.decisionId,
      actionId: 'request-corrected-document',
      expectedRevision: paused.snapshot.revision,
      idempotencyKey: 'trial-correct-014',
    });
    expect(duplicate.events).toHaveLength(corrected.events.length);
  });

  it('produces equivalent capabilities for a second random step ID', async () => {
    const first = await inferFlowMutation({
      instruction,
      expectedFlowVersion: 1,
      provider: demoAgent,
    });
    const second = await inferFlowMutation({
      instruction,
      expectedFlowVersion: 1,
      provider: demoAgent,
    });
    expect(first.step.id).not.toBe(second.step.id);
    expect(second.step.capabilities).toEqual(first.step.capabilities);
    expect(second.step.kind).toBe(first.step.kind);
    expect(second.step.tool).toEqual(first.step.tool);
  });

  it('continues safely when a human approves an exception on match/mismatch transitions', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const created = await store.createRun({ demoId: 'booking-preparation' });
    const mutation = await inferFlowMutation({
      instruction,
      expectedFlowVersion: created.flow.version,
      provider: demoAgent,
    });
    const paused = await store.mutateFlow(created.snapshot.runId, mutation);
    const decision = paused.snapshot.pendingDecision!;

    const approved = await store.submitAction(created.snapshot.runId, {
      runId: created.snapshot.runId,
      decisionId: decision.decisionId,
      actionId: 'approve-exception',
      expectedRevision: paused.snapshot.revision,
      idempotencyKey: 'approve-direct-flow-exception',
    });

    expect(approved.snapshot.runId).toBe(created.snapshot.runId);
    expect(approved.snapshot.status).toBe('completed');
    expect(
      approved.events.some(
        (event) => event.type === 'step.started' && event.stepId === 'confirm-booking',
      ),
    ).toBe(true);
  });

  it('skips the maritime-only validation for AIR', async () => {
    const store = new InMemoryRunStore(new FlowEngine(demoAgent));
    const created = await store.createRun({
      demoId: 'booking-preparation',
      seed: {
        shipment: {
          orderId: 'RS-AIR-001',
          scenarioId: 'EVT-012',
          transportMode: 'AIR',
          origin: 'Frankfurt',
          destination: 'Atlanta',
          disruption: 'NONE',
        },
        booking: {
          bookingNumber: 'AIR-BOOKING',
          portOfLoading: 'FRA',
          portOfDischarge: 'ATL',
        },
        billOfLading: {
          bookingNumber: 'AIR-BOOKING',
          portOfLoading: 'FRA',
          portOfDischarge: 'ATL',
        },
      },
    });
    const mutation = await inferFlowMutation({
      instruction,
      expectedFlowVersion: created.flow.version,
      provider: demoAgent,
    });
    const result = await store.mutateFlow(created.snapshot.runId, mutation);
    expect(result.snapshot.skippedStepIds).toContain(mutation.step.id);
    expect(
      result.events.some(
        (event) => event.type === 'step.skipped' && event.stepId === mutation.step.id,
      ),
    ).toBe(true);
    expect(result.snapshot.status).toBe('completed');
  });
});
