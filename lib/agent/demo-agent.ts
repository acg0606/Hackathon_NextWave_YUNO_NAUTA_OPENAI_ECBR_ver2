import type {
  AgentProvider,
  DocumentComparison,
  DocumentDifference,
  PublicAgentSummary,
  SemanticStepInference,
  SemanticStepIntent,
} from './agent-provider';

const FORBIDDEN_INSTRUCTION = /<\/?(?:script|style|iframe)|javascript:|data:text\/html|\b(?:eval|import)\s*\(/i;

function normalizeInstruction(instruction: string) {
  return instruction.trim().replace(/\s+/g, ' ').slice(0, 500);
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function compareValues(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): DocumentDifference[] {
  const fields = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter((field) => !['sourceUrl', 'retrievedAt'].includes(field))
    .sort();

  return fields.flatMap((field) => {
    const left = expected[field];
    const right = actual[field];
    if (Object.is(left, right)) return [];
    if (
      (typeof left === 'object' && left !== null) ||
      (typeof right === 'object' && right !== null)
    ) {
      return [];
    }

    const difference: DocumentDifference = {
      field,
      expected: (left ?? null) as string | number | boolean | null,
      actual: (right ?? null) as string | number | boolean | null,
      blocking: [
        'bookingNumber',
        'containerNumber',
        'portOfLoading',
        'portOfDischarge',
        'grossWeightKg',
        'packageCount',
      ].includes(field),
    };

    if (typeof left === 'number' && typeof right === 'number') {
      difference.delta = round(right - left);
      if (left !== 0) difference.deltaPercent = round(((right - left) / left) * 100);
    }

    return [difference];
  });
}

export class DemoAgent implements AgentProvider {
  readonly id = 'demo-agent-v1';
  readonly deterministic = true;

  async inferStep(instruction: string): Promise<SemanticStepIntent | null> {
    const normalized = normalizeInstruction(instruction);
    if (!normalized || FORBIDDEN_INSTRUCTION.test(normalized)) return null;

    const lower = normalized.toLowerCase();
    const compareDocuments =
      (lower.includes('bill of lading') || lower.includes('b/l')) &&
      lower.includes('booking') &&
      (lower.includes('validate') || lower.includes('compare'));

    if (compareDocuments) {
      return {
        title: 'Validate Bill of Lading against booking before confirming',
        description:
          'Compare the issued Bill of Lading with the booking artifact and request a human decision for blocking discrepancies.',
        kind: 'validate',
        capabilities: ['document.view', 'document.compare', 'decision.request'],
        owner: 'agent',
        tool: 'mock.document.compare',
        after: 'prepare-booking',
        before: 'confirm-booking',
        condition: {
          path: 'shipment.transportMode',
          operator: 'in',
          value: ['OCEAN', 'OCEAN_ROAD', 'RAIL_OCEAN'],
        },
        inputRefs: {
          expected: 'artifacts.booking',
          actual: 'artifacts.billOfLading',
        },
        transitions: {
          match: 'confirm-booking',
          mismatch: 'await-human',
        },
      };
    }

    if (lower.includes('monitor') || lower.includes('track')) {
      return {
        title: normalized,
        description: 'Monitor the requested operation and surface material changes.',
        kind: 'monitor',
        capabilities: ['route.view', 'container.track', 'audit.view'],
        owner: 'agent',
        tool: 'mock.nauta.track',
      };
    }

    if (lower.includes('notify') || lower.includes('alert')) {
      return {
        title: normalized,
        description: 'Notify the configured audience with a public operational summary.',
        kind: 'notify',
        capabilities: ['notification.view', 'audit.view'],
        owner: 'agent',
        tool: 'agent.classify',
      };
    }

    if (lower.includes('approve') || lower.includes('decide')) {
      return {
        title: normalized,
        description: 'Request an explicit human decision before continuing the run.',
        kind: 'decide',
        capabilities: ['decision.request', 'audit.view'],
        owner: 'human',
      };
    }

    return {
      title: normalized,
      description: 'Execute the newly introduced flow step using the safe generic runtime.',
      kind: 'generic',
      capabilities: ['audit.view'],
      owner: 'agent',
    };
  }

  async inferStepWithTelemetry(instruction: string): Promise<SemanticStepInference> {
    return {
      intent: await this.inferStep(instruction),
      telemetry: {
        providerId: this.id,
        providerMode: 'deterministic_fallback',
        structuredOutput: true,
        fallbackReason: 'not_configured',
      },
    };
  }

  async compareDocuments(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
  ): Promise<DocumentComparison> {
    const differences = compareValues(expected, actual);
    const blocking = differences.filter((difference) => difference.blocking);
    const matches = blocking.length === 0;

    return {
      matches,
      confidence: matches ? 0.99 : 0.98,
      differences,
      recommendedAction: matches ? 'continue' : 'request-corrected-document',
      publicSummary: matches
        ? 'The Bill of Lading matches the booking on every blocking field.'
        : `${blocking.length} blocking document ${blocking.length === 1 ? 'difference requires' : 'differences require'} resolution before booking confirmation.`,
    };
  }

  async summarize(input: {
    objective: string;
    evidence: string[];
    confidence?: number;
    selectedAction?: string;
  }): Promise<PublicAgentSummary> {
    return {
      summary: input.objective.slice(0, 500),
      evidence: input.evidence.slice(0, 12).map((item) => item.slice(0, 300)),
      confidence: input.confidence ?? 0.95,
      selectedAction: input.selectedAction?.slice(0, 120),
      providerId: this.id,
      providerMode: 'deterministic_fallback',
    };
  }
}

export const demoAgent = new DemoAgent();
