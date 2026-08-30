import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { RuntimeArtifact, StepDefinition } from '@/lib/runtime/contracts';
import { compileRuntimeUI } from '@/lib/runtime/ui-compiler';
import { fixedNow, makeFlow, makeSnapshot, makeStep } from '@/tests/fixtures/runtime-fixtures';

function comparisonStep(id = randomUUID()): StepDefinition {
  return makeStep({
    id,
    title: 'Validate Bill of Lading against booking before confirming',
    description: 'Compare the expected booking with the actual transport document.',
    kind: 'validate',
    capabilities: ['document.view', 'document.compare', 'decision.request', 'audit.view'],
    inputRefs: {
      expected: 'artifacts.booking',
      actual: 'artifacts.billOfLading',
    },
    tool: { id: 'mock.document.compare' },
  });
}

function artifact(
  id: string,
  kind: string,
  value: RuntimeArtifact['value'],
): RuntimeArtifact {
  return {
    id,
    kind,
    value,
    truth: 'MOCK_CONNECTOR',
    revision: 3,
    updatedAt: fixedNow,
  };
}

describe('semantic UI compiler', () => {
  it('composes a comparison UI without knowing the random step ID', () => {
    const step = comparisonStep();
    const flow = makeFlow(step);
    const snapshot = makeSnapshot(step, {
      artifacts: {
        booking: artifact('booking', 'booking', {
          portOfDischarge: 'TRISK',
          grossWeightKg: 18_240,
        }),
        billOfLading: artifact('billOfLading', 'bill-of-lading', {
          portOfDischarge: 'TRMER',
          grossWeightKg: 19_050,
        }),
      },
      publicAgentSummary: {
        summary: 'Two blocking differences require a human decision.',
        evidence: ['portOfDischarge', 'grossWeightKg'],
        confidence: 0.98,
      },
    });

    const spec = compileRuntimeUI(flow, snapshot);
    expect(spec.sections.map((section) => section.type)).toEqual([
      'document-comparison',
      'evidence',
      'discrepancy',
      'confidence',
      'decision',
      'event-feed',
      'progress',
    ]);
    const comparison = spec.sections.find((section) => section.type === 'document-comparison');
    expect(JSON.stringify(comparison?.data)).toContain('TRISK');
    expect(JSON.stringify(comparison?.data)).toContain('TRMER');
    const evidence = spec.sections.find((section) => section.type === 'evidence');
    expect(JSON.stringify(evidence?.data)).toContain('Booking summary');
    expect(JSON.stringify(evidence?.data)).toContain('Bill of Lading summary');
    expect(JSON.stringify(evidence?.data)).toContain('Two blocking differences');
  });

  it('produces the same semantic structure for a second random ID', () => {
    const first = comparisonStep();
    const second = comparisonStep();
    const semanticTypes = (step: StepDefinition) =>
      compileRuntimeUI(makeFlow(step), makeSnapshot(step)).sections.map((section) => section.type);

    expect(first.id).not.toBe(second.id);
    expect(semanticTypes(first)).toEqual(semanticTypes(second));
  });

  it('uses the safe generic inspector for a valid step with no registered capability', () => {
    const step = makeStep({
      id: randomUUID(),
      title: 'Inspect an unknown operation',
      kind: 'generic',
      capabilities: [],
    });
    const spec = compileRuntimeUI(makeFlow(step), makeSnapshot(step));
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0]?.type).toBe('generic-step');
  });

  it('keeps the last completed operational surface instead of collapsing to progress', () => {
    const step = makeStep({
      id: 'monitor-any-shipment',
      title: 'Monitor a shipment',
      kind: 'monitor',
      capabilities: ['route.view', 'container.track', 'audit.view'],
      presentation: { layout: 'timeline', focus: 'container.track' },
    });
    const snapshot = makeSnapshot(step, {
      status: 'completed',
      currentStepId: null,
      completedStepIds: [step.id],
      artifacts: {
        shipment: artifact('shipment', 'shipment-route', {
          origin: 'Shanghai',
          destination: 'Gaziantep',
          state: 'IN_TRANSIT',
        }),
        container: artifact('container', 'container', { containerNumber: 'MSCU0142026' }),
      },
    });

    const spec = compileRuntimeUI(makeFlow(step), snapshot);
    expect(spec.layout).toBe('timeline');
    expect(spec.sections.map((section) => section.type)).toEqual([
      'route-map',
      'container',
      'event-feed',
      'progress',
    ]);
  });

  it('publishes the dispatch trajectory and agent highlight on the progress surface', () => {
    const step = makeStep({
      id: 'explain-disruption',
      title: 'Explain the operational disruption',
      kind: 'monitor',
      owner: 'agent',
      capabilities: ['route.view', 'incident.explain', 'audit.view'],
    });
    const snapshot = makeSnapshot(step, {
      publicAgentSummary: {
        summary: 'The planned corridor is closed.',
        evidence: ['port closure'],
        providerMode: 'live',
        model: 'gpt-5-mini',
      },
      artifacts: {
        shipment: artifact('shipment', 'shipment', {
          origin: 'Shanghai',
          destination: 'Gaziantep',
          plannedRoute: ['Shanghai', 'Iskenderun', 'Gaziantep'],
          route: ['Shanghai', 'Mersin', 'Gaziantep'],
          disruption: 'Port closed',
          state: 'disrupted',
        }),
      },
    });

    const spec = compileRuntimeUI(makeFlow(step), snapshot);
    const progress = spec.sections.find((section) => section.type === 'progress');
    expect(progress?.data.trajectoryShift).toMatchObject({
      kind: 'disruption',
      from: ['Shanghai', 'Iskenderun', 'Gaziantep'],
      to: ['Shanghai', 'Mersin', 'Gaziantep'],
      agentLabel: 'Ari · gpt-5-mini',
    });
    expect(progress?.data.items).toEqual([
      expect.objectContaining({
        stepId: 'explain-disruption',
        owner: 'agent',
        agentHighlighted: true,
      }),
    ]);
  });

  it('renders prepared booking and Bill of Lading artifacts as documents', () => {
    const step = makeStep({ capabilities: ['booking.view', 'document.view', 'quote.view'] });
    const snapshot = makeSnapshot(step, {
      status: 'completed',
      currentStepId: null,
      completedStepIds: [step.id],
      artifacts: {
        booking: artifact('booking', 'booking', { bookingNumber: 'BKG-NW26-014' }),
        billOfLading: artifact('billOfLading', 'bill-of-lading', { billNumber: 'MAEU-NW26-014' }),
      },
    });

    const spec = compileRuntimeUI(makeFlow(step), snapshot);
    const documents = spec.sections.find((section) => section.title === 'Documents');
    expect(documents?.data.items).toHaveLength(2);
    const renderedDocuments = JSON.stringify(documents?.data.items);
    expect(renderedDocuments).toContain('Bill of Lading');
    expect(renderedDocuments).toContain('MAEU-NW26-014');
    expect(renderedDocuments).toContain('Booking BKG-NW26-014');
  });
});
