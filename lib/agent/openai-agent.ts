import OpenAI from 'openai';
import { z } from 'zod';

import type {
  AgentFallbackReason,
  AgentProvider,
  DocumentComparison,
  PublicAgentSummary,
  SemanticStepInference,
  SemanticStepIntent,
} from './agent-provider';
import { demoAgent } from './demo-agent';
import { recordOpenAIFailure, recordOpenAISuccess } from './provider-health';

const DEFAULT_MODEL = 'gpt-5-mini';
const DEFAULT_TIMEOUT_MS = 12_000;

const semanticStepIntentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    kind: z.enum(['extract', 'monitor', 'validate', 'decide', 'notify', 'fulfill', 'generic']),
    capabilities: z
      .array(
        z.enum([
          'route.view',
          'booking.view',
          'container.track',
          'document.view',
          'document.compare',
          'incident.explain',
          'quote.view',
          'refund.view',
          'decision.request',
          'notification.view',
          'delivery.confirm',
          'audit.view',
        ]),
      )
      .max(8),
    owner: z.enum(['agent', 'human', 'system']),
    tool: z.enum(['mock.document.compare', 'mock.nauta.track', 'agent.classify']).nullable(),
    after: z.string().trim().min(1).max(100).nullable(),
    before: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

const publicSummarySchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    evidence: z.array(z.string().trim().min(1).max(300)).max(12),
    confidence: z.number().min(0).max(1),
    selectedAction: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();

type StructuredEnvelope<T> = {
  value: T;
};

type StructuredResult<T> = {
  value: T | null;
  outcome: 'live' | AgentFallbackReason;
  providerStatus?: number;
};

type ProviderFailure = {
  outcome: AgentFallbackReason;
  providerStatus?: number;
};

function safeProviderStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined;
}

function safeProviderCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(code)
    ? code.toLowerCase()
    : '';
}

export function classifyOpenAIProviderFailure(error: unknown): ProviderFailure {
  const providerStatus = safeProviderStatus(error);
  const code = safeProviderCode(error);
  const name = error && typeof error === 'object' && 'name' in error &&
    typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : '';

  if (providerStatus === 401 || code === 'invalid_api_key') {
    return { outcome: 'authentication_failed', providerStatus };
  }
  if (providerStatus === 429 && code === 'insufficient_quota') {
    return { outcome: 'insufficient_quota', providerStatus };
  }
  if (providerStatus === 429) return { outcome: 'rate_limited', providerStatus };
  if (providerStatus === 403 || code === 'model_not_found') {
    return { outcome: 'access_denied', providerStatus };
  }
  if (name === 'AbortError' || name === 'APIConnectionTimeoutError') {
    return { outcome: 'provider_timeout', providerStatus };
  }
  if (name === 'APIConnectionError' || name === 'FetchError') {
    return { outcome: 'transport_unavailable', providerStatus };
  }
  return { outcome: 'provider_unavailable', providerStatus };
}

function parseEnvelope<T>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as StructuredEnvelope<T>;
    return parsed?.value ?? null;
  } catch {
    return null;
  }
}

function timeoutMs() {
  const configured = Number(process.env.OPENAI_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured)
    ? Math.min(20_000, Math.max(500, Math.round(configured)))
    : DEFAULT_TIMEOUT_MS;
}

function configuredModel() {
  const candidate = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)
    ? candidate
    : DEFAULT_MODEL;
}

export function mergeSemanticStepIntent(
  model: SemanticStepIntent,
  deterministic: SemanticStepIntent | null,
): SemanticStepIntent {
  if (!deterministic) return model;
  const hasProtectedRuntimeSemantics = Boolean(
    deterministic.condition ||
      deterministic.inputRefs ||
      deterministic.transitions ||
      deterministic.after ||
      deterministic.before,
  );
  if (!hasProtectedRuntimeSemantics) return model;

  return {
    ...model,
    kind: deterministic.kind,
    owner: deterministic.owner,
    capabilities: [...new Set([...deterministic.capabilities, ...model.capabilities])],
    tool: deterministic.tool ?? model.tool,
    condition: deterministic.condition,
    inputRefs: deterministic.inputRefs,
    transitions: deterministic.transitions,
    after: deterministic.after ?? model.after,
    before: deterministic.before ?? model.before,
  };
}

export class OpenAIAgent implements AgentProvider {
  readonly id = 'openai-structured-agent-v1';
  readonly deterministic = false;
  private readonly fallback: AgentProvider;

  constructor(fallback: AgentProvider = demoAgent) {
    this.fallback = fallback;
  }

  private client() {
    const apiKey = process.env.OPENAI_API_KEY;
    return apiKey ? new OpenAI({ apiKey }) : null;
  }

  private async structured<T>(
    instruction: string,
    schemaName: string,
    schema: Record<string, unknown>,
  ): Promise<StructuredResult<T>> {
    const startedAt = Date.now();
    const client = this.client();
    if (!client) {
      recordOpenAIFailure({ latencyMs: 0, reason: 'not_configured' });
      return { value: null, outcome: 'not_configured' };
    }

    const controller = new AbortController();
    const deadline = timeoutMs();
    const timer = setTimeout(() => controller.abort(), deadline);

    try {
      const model = configuredModel();
      const response = await client.responses.create({
        model,
        ...(model.startsWith('gpt-5')
          ? { reasoning: { effort: 'minimal' as const } }
          : {}),
        max_output_tokens: 800,
        instructions:
          'Return only the requested bounded semantic JSON. Never emit HTML, JSX, CSS, JavaScript, imports, URLs, secrets, private reasoning, or unregistered capabilities.',
        input: instruction.slice(0, 4_000),
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['value'],
              properties: { value: schema },
            },
          },
        },
      }, {
        signal: controller.signal,
        timeout: deadline,
        maxRetries: 0,
      });
      const value = parseEnvelope<T>(response.output_text);
      if (value === null) {
        recordOpenAIFailure({ latencyMs: Date.now() - startedAt, reason: 'invalid_output' });
        return { value: null, outcome: 'invalid_output' };
      }
      recordOpenAISuccess(Date.now() - startedAt);
      return { value, outcome: 'live' };
    } catch (error) {
      const failure = controller.signal.aborted
        ? { outcome: 'provider_timeout' as const }
        : classifyOpenAIProviderFailure(error);
      recordOpenAIFailure({
        latencyMs: Date.now() - startedAt,
        reason: failure.outcome,
        providerStatus: failure.providerStatus,
      });
      return { value: null, ...failure };
    } finally {
      clearTimeout(timer);
    }
  }

  async inferStep(instruction: string): Promise<SemanticStepIntent | null> {
    return (await this.inferStepWithTelemetry(instruction)).intent;
  }

  async inferStepWithTelemetry(instruction: string): Promise<SemanticStepInference> {
    const deterministic = await this.fallback.inferStep(instruction);
    const result = await this.structured<SemanticStepIntent>(
      instruction,
      'route_shift_step_intent',
      {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'kind', 'capabilities', 'owner', 'tool', 'after', 'before'],
        properties: {
          title: { type: 'string', maxLength: 160 },
          description: { type: 'string', maxLength: 500 },
          kind: {
            type: 'string',
            enum: ['extract', 'monitor', 'validate', 'decide', 'notify', 'fulfill', 'generic'],
          },
          capabilities: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'string',
              enum: [
                'route.view',
                'booking.view',
                'container.track',
                'document.view',
                'document.compare',
                'incident.explain',
                'quote.view',
                'refund.view',
                'decision.request',
                'notification.view',
                'delivery.confirm',
                'audit.view',
              ],
            },
          },
          owner: { type: 'string', enum: ['agent', 'human', 'system'] },
          tool: {
            anyOf: [
              { type: 'string', enum: ['mock.document.compare', 'mock.nauta.track', 'agent.classify'] },
              { type: 'null' },
            ],
          },
          after: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
          before: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
        },
      },
    );

    const validated = semanticStepIntentSchema.safeParse(result.value);
    if (!validated.success) {
      return {
        intent: deterministic,
        telemetry: {
          providerId: this.fallback.id,
          providerMode: 'deterministic_fallback',
          structuredOutput: true,
          model: configuredModel(),
          fallbackReason:
            result.outcome === 'not_configured'
              ? 'not_configured'
              : result.outcome === 'invalid_output'
                ? 'invalid_output'
                : result.outcome === 'live'
                  ? 'invalid_output'
                  : result.outcome,
          providerStatus: result.providerStatus,
        },
      };
    }
    const modelIntent: SemanticStepIntent = {
      ...validated.data,
      tool: validated.data.tool ?? undefined,
      after: validated.data.after ?? undefined,
      before: validated.data.before ?? undefined,
    };
    return {
      intent: mergeSemanticStepIntent(modelIntent, deterministic),
      telemetry: {
        providerId: this.id,
        providerMode: 'live',
        structuredOutput: true,
        model: configuredModel(),
      },
    };
  }

  async compareDocuments(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
  ): Promise<DocumentComparison> {
    // Deterministic comparison remains authoritative. The optional model is not
    // allowed to invent document facts or alter blocking outcomes.
    return this.fallback.compareDocuments(expected, actual);
  }

  async summarize(input: {
    objective: string;
    evidence: string[];
    confidence?: number;
    selectedAction?: string;
  }): Promise<PublicAgentSummary> {
    const fallback = await this.fallback.summarize(input);
    const result = await this.structured<z.infer<typeof publicSummarySchema>>(
      JSON.stringify({
        objective: input.objective.slice(0, 500),
        evidence: input.evidence.slice(0, 12).map((item) => item.slice(0, 300)),
        confidence: input.confidence ?? 0.95,
        selectedAction: input.selectedAction?.slice(0, 120) ?? null,
      }),
      'route_shift_public_summary',
      {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'evidence', 'confidence', 'selectedAction'],
        properties: {
          summary: { type: 'string', maxLength: 500 },
          evidence: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string', maxLength: 300 },
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          selectedAction: {
            anyOf: [
              { type: 'string', maxLength: 120 },
              { type: 'null' },
            ],
          },
        },
      },
    );
    const validated = publicSummarySchema.safeParse(result.value);
    if (!validated.success) {
      return {
        ...fallback,
        providerId: this.fallback.id,
        providerMode: 'deterministic_fallback',
        model: configuredModel(),
      };
    }
    return {
      ...validated.data,
      selectedAction: validated.data.selectedAction ?? undefined,
      providerId: this.id,
      providerMode: 'live',
      model: configuredModel(),
    };
  }
}

export const openAIAgent = new OpenAIAgent();

export function configuredAgent(): AgentProvider {
  return process.env.OPENAI_API_KEY ? openAIAgent : demoAgent;
}
