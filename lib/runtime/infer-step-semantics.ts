import type {
  AgentInferenceTelemetry,
  AgentProvider,
  SemanticStepIntent,
} from '@/lib/agent/agent-provider';
import { configuredAgent } from '@/lib/agent/openai-agent';
import type {
  FlowMutation,
  JsonValue,
  StepCapability,
  StepCondition,
  StepDefinition,
  StepTransitionRule,
  ToolId,
} from './contracts';

const ALLOWED_TOOLS = new Set<ToolId>([
  'mock.document.compare',
  'mock.document.correct',
  'mock.yuno.quote',
  'mock.yuno.requote',
  'mock.yuno.refund',
  'mock.yuno.payment',
  'route.pricing.quote',
  'route.pricing.requote',
  'yuno.sandbox.payment-link',
  'yuno.sandbox.cancel-or-refund',
  'mock.nauta.track',
  'mock.nauta.reroute',
  'mock.nauta.milestones',
  'nasa.eonet.current-context',
  'transport.live-context',
  'agent.extract',
  'agent.classify',
]);

const EXECUTABLE_TEXT = /<\/?(?:script|style|iframe)|javascript:|data:text\/html|\b(?:eval|import)\s*\(/i;

function idForIntent() {
  return `step-${crypto.randomUUID()}`;
}

function conditionFromIntent(intent: SemanticStepIntent): StepCondition | undefined {
  if (!intent.condition) return undefined;
  return {
    all: [
      {
        path: intent.condition.path,
        operator: intent.condition.operator,
        value: intent.condition.value as JsonValue | undefined,
      },
    ],
  };
}

function transitionsFromIntent(intent: SemanticStepIntent): StepTransitionRule[] | undefined {
  if (!intent.transitions) return undefined;
  const rules = Object.entries(intent.transitions).slice(0, 8).map(([outcome, toStepId]) => ({
    outcome,
    toStepId: toStepId === 'await-human' ? null : toStepId,
  }));
  return rules.length ? rules : undefined;
}

export async function inferStepDefinition(
  instruction: string,
  provider: AgentProvider = configuredAgent(),
): Promise<{
  step: StepDefinition;
  afterStepId?: string;
  beforeStepId?: string;
  agentExecution: AgentInferenceTelemetry;
}> {
  const clean = instruction.trim().replace(/\s+/g, ' ').slice(0, 500);
  if (!clean || EXECUTABLE_TEXT.test(clean)) {
    throw new Error('The instruction is empty or contains executable content.');
  }

  const inference = provider.inferStepWithTelemetry
    ? await provider.inferStepWithTelemetry(clean)
    : {
        intent: await provider.inferStep(clean),
        telemetry: {
          providerId: provider.id,
          providerMode: provider.deterministic ? 'deterministic_fallback' as const : 'live' as const,
          structuredOutput: false,
        },
      };
  const intent = inference.intent;
  if (!intent) throw new Error('The instruction could not be mapped to a safe semantic step.');

  const tool = intent.tool && ALLOWED_TOOLS.has(intent.tool as ToolId)
    ? { id: intent.tool as ToolId }
    : undefined;

  const step: StepDefinition = {
    schemaVersion: '1.0',
    id: idForIntent(),
    title: intent.title.slice(0, 160),
    description: intent.description.slice(0, 500),
    kind: intent.kind,
    capabilities: [...new Set(intent.capabilities)].slice(0, 12) as StepCapability[],
    owner: intent.owner,
    when: conditionFromIntent(intent),
    inputRefs: intent.inputRefs,
    tool,
    transitions: transitionsFromIntent(intent),
    presentation: {
      priority: intent.capabilities.includes('decision.request') ? 'critical' : 'normal',
      layout: intent.capabilities.includes('document.compare') ? 'split' : 'generic',
      focus: intent.capabilities[0] as StepCapability | undefined,
    },
    timeoutMs: 10_000,
    retry: { maxAttempts: 2, backoffMs: 250 },
  };

  return {
    step,
    afterStepId: intent.after,
    beforeStepId: intent.before,
    agentExecution: inference.telemetry,
  };
}

export async function inferFlowMutation(input: {
  instruction: string;
  expectedFlowVersion: number;
  provider?: AgentProvider;
}): Promise<FlowMutation> {
  const inferred = await inferStepDefinition(input.instruction, input.provider);
  return {
    schemaVersion: '1.0',
    operation: 'insert-step',
    expectedFlowVersion: input.expectedFlowVersion,
    step: inferred.step,
    position: inferred.afterStepId
      ? { afterStepId: inferred.afterStepId }
      : { beforeStepId: inferred.beforeStepId ?? 'confirm-booking' },
    instruction: input.instruction.slice(0, 500),
  };
}

export async function inferFlowMutationWithTelemetry(input: {
  instruction: string;
  expectedFlowVersion: number;
  provider?: AgentProvider;
}): Promise<{ mutation: FlowMutation; agentExecution: AgentInferenceTelemetry }> {
  const inferred = await inferStepDefinition(
    input.instruction,
    input.provider ?? configuredAgent(),
  );
  return {
    mutation: {
      schemaVersion: '1.0',
      operation: 'insert-step',
      expectedFlowVersion: input.expectedFlowVersion,
      step: inferred.step,
      position: inferred.afterStepId
        ? { afterStepId: inferred.afterStepId }
        : { beforeStepId: inferred.beforeStepId ?? 'confirm-booking' },
      instruction: input.instruction.slice(0, 500),
    },
    agentExecution: inferred.agentExecution,
  };
}
