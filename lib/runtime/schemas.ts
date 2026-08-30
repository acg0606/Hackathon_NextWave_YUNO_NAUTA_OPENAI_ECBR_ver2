import { z } from 'zod';

import {
  RUN_EVENT_TYPES,
  RUN_STATUSES,
  RUNTIME_ACTION_INTENTS,
  RUNTIME_SECTION_TYPES,
  STEP_CAPABILITIES,
  STEP_KINDS,
  STEP_OWNERS,
  TOOL_IDS,
  TRUTH_CLASSIFICATIONS,
  type JsonValue,
} from './contracts';
import { isSafeEvidenceUrl } from './safe-url';

export { isSafeEvidenceUrl, SAFE_SOURCE_HOSTS } from './safe-url';

const MAX_JSON_BYTES = 65_536;
// Event payloads wrap a validated UI spec (payload -> spec -> sections -> data
// -> rows -> row values). Ten levels keeps that protocol valid while still
// rejecting unbounded agent-authored structures.
const MAX_JSON_DEPTH = 10;
const MAX_OBJECT_KEYS = 64;
const MAX_ARRAY_ITEMS = 64;
const MAX_TEXT_LENGTH = 4_000;

const forbiddenKeys = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'html',
  'css',
  'jsx',
  'javascript',
  'script',
  'style',
  'import',
  'componentname',
  'dangerouslysetinnerhtml',
]);

const unsafeMarkup =
  /<\s*\/?\s*(?:script|style|iframe|object|embed|html|body)\b|\bon[a-z]+\s*=/i;
const unsafeProtocol = /(?:javascript|data|vbscript)\s*:/i;
const httpSchemePrefix = /https?\s*:/i;

function isDedicatedSourceUrl(path: readonly string[], value: string): boolean {
  return path.at(-1) === 'sourceUrl' && isSafeEvidenceUrl(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateJsonNode(
  value: unknown,
  depth: number,
  path: readonly string[] = [],
): value is JsonValue {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    if (httpSchemePrefix.test(value) && !isDedicatedSourceUrl(path, value)) {
      return false;
    }
    return (
      value.length <= MAX_TEXT_LENGTH &&
      !unsafeMarkup.test(value) &&
      !unsafeProtocol.test(value)
    );
  }
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_ARRAY_ITEMS &&
      value.every((item, index) =>
        validateJsonNode(item, depth + 1, [...path, String(index)]),
      )
    );
  }
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_OBJECT_KEYS &&
    entries.every(
      ([key, item]) =>
        key.length > 0 &&
        key.length <= 80 &&
        !forbiddenKeys.has(key.toLowerCase()) &&
        validateJsonNode(item, depth + 1, [...path, key]),
    )
  );
}

function isBoundedJson(value: unknown): value is JsonValue {
  if (!validateJsonNode(value, 0)) return false;
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      MAX_JSON_BYTES
    );
  } catch {
    return false;
  }
}

export const jsonValueSchema = z.custom<JsonValue>(isBoundedJson, {
  message:
    'Value must be bounded JSON without executable markup, code, unsafe protocols, or arbitrary URLs',
});

export const jsonObjectSchema = z
  .custom<Record<string, JsonValue>>(
    (value) => isPlainObject(value) && isBoundedJson(value),
    { message: 'Value must be a bounded JSON object' },
  )
  .transform((value) => value as Record<string, JsonValue>);

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Use a safe opaque identifier');

const pathSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/,
    'Use a dotted data reference',
  );

const textSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TEXT_LENGTH)
  .refine(
    (value) =>
      !unsafeMarkup.test(value) &&
      !unsafeProtocol.test(value) &&
      !httpSchemePrefix.test(value),
    'Executable markup, unsafe protocols, and arbitrary URLs are not allowed',
  );

const shortTextSchema = textSchema.max(240);

export const truthClassificationSchema = z.enum(TRUTH_CLASSIFICATIONS);
export const stepCapabilitySchema = z.enum(STEP_CAPABILITIES);
export const runtimeSectionTypeSchema = z.enum(RUNTIME_SECTION_TYPES);

export const safeHttpsUrlSchema = z
  .string()
  .max(2_048)
  .refine(
    isSafeEvidenceUrl,
    'Source URL must be canonical HTTPS on an allowlisted host without credentials or a custom port',
  );

export const conditionPredicateSchema = z
  .object({
    path: pathSchema,
    operator: z.enum([
      'equals',
      'not_equals',
      'in',
      'not_in',
      'exists',
      'not_exists',
      'gt',
      'gte',
      'lt',
      'lte',
    ]),
    value: jsonValueSchema.optional(),
  })
  .strict()
  .superRefine((condition, context) => {
    const valueRequired = !['exists', 'not_exists'].includes(
      condition.operator,
    );
    if (valueRequired && condition.value === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'This operator requires a value',
      });
    }
    if (!valueRequired && condition.value !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'This operator does not accept a value',
      });
    }
    if (
      ['in', 'not_in'].includes(condition.operator) &&
      !Array.isArray(condition.value)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Membership operators require an array',
      });
    }
  });

export const stepConditionSchema = z
  .object({
    all: z.array(conditionPredicateSchema).min(1).max(16).optional(),
    any: z.array(conditionPredicateSchema).min(1).max(16).optional(),
  })
  .strict()
  .refine(
    (condition) => Boolean(condition.all || condition.any),
    'A condition needs all or any predicates',
  );

export const allowedActionSchema = z
  .object({
    actionId: idSchema,
    label: shortTextSchema,
    intent: z.enum(RUNTIME_ACTION_INTENTS),
    requiresConfirmation: z.boolean().optional(),
    inputSchema: jsonObjectSchema.optional(),
  })
  .strict();

export const stepDefinitionSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: idSchema,
    title: shortTextSchema,
    description: textSchema,
    kind: z.enum(STEP_KINDS),
    capabilities: z.array(stepCapabilitySchema).max(12),
    owner: z.enum(STEP_OWNERS),
    when: stepConditionSchema.optional(),
    inputRefs: z
      .record(z.string().min(1).max(80), pathSchema)
      .refine(
        (refs) => Object.keys(refs).length <= 32,
        'At most 32 input references are allowed',
      )
      .optional(),
    tool: z
      .object({
        id: z.enum(TOOL_IDS),
        parameters: jsonObjectSchema.optional(),
      })
      .strict()
      .optional(),
    transitions: z
      .array(
        z
          .object({
            outcome: idSchema,
            toStepId: idSchema.nullable(),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    presentation: z
      .object({
        priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
        layout: z
          .enum(['focus', 'split', 'timeline', 'receipt', 'generic'])
          .optional(),
        focus: stepCapabilitySchema.optional(),
        preferredSections: z.array(runtimeSectionTypeSchema).max(16).optional(),
      })
      .strict()
      .optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(5),
        backoffMs: z.number().int().min(0).max(30_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((step, context) => {
    if (new Set(step.capabilities).size !== step.capabilities.length) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'Capabilities must be unique',
      });
    }
    const outcomes =
      step.transitions?.map((transition) => transition.outcome) ?? [];
    if (new Set(outcomes).size !== outcomes.length) {
      context.addIssue({
        code: 'custom',
        path: ['transitions'],
        message: 'Transition outcomes must be unique',
      });
    }
    if (
      step.presentation?.focus &&
      !step.capabilities.includes(step.presentation.focus)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['presentation', 'focus'],
        message: 'Focus must be an enabled capability',
      });
    }
  });

export const flowDefinitionSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: idSchema,
    version: z.number().int().positive().max(1_000_000),
    name: shortTextSchema,
    description: textSchema,
    entryStepId: idSchema,
    steps: z.array(stepDefinitionSchema).min(1).max(64),
    transitions: z
      .array(
        z
          .object({
            fromStepId: idSchema,
            outcome: idSchema,
            toStepId: idSchema.nullable(),
          })
          .strict(),
      )
      .max(256),
    metadata: jsonObjectSchema,
  })
  .strict()
  .superRefine((flow, context) => {
    const stepIds = flow.steps.map((step) => step.id);
    const known = new Set(stepIds);
    if (known.size !== stepIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Step IDs must be unique',
      });
    }
    if (!known.has(flow.entryStepId)) {
      context.addIssue({
        code: 'custom',
        path: ['entryStepId'],
        message: 'Entry step must exist',
      });
    }
    for (const [index, transition] of flow.transitions.entries()) {
      if (!known.has(transition.fromStepId)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'fromStepId'],
          message: 'Unknown source step',
        });
      }
      if (transition.toStepId !== null && !known.has(transition.toStepId)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'toStepId'],
          message: 'Unknown target step',
        });
      }
    }
    for (const [stepIndex, step] of flow.steps.entries()) {
      for (const [transitionIndex, transition] of (
        step.transitions ?? []
      ).entries()) {
        if (transition.toStepId !== null && !known.has(transition.toStepId)) {
          context.addIssue({
            code: 'custom',
            path: [
              'steps',
              stepIndex,
              'transitions',
              transitionIndex,
              'toStepId',
            ],
            message: 'Unknown target step',
          });
        }
      }
    }
  });

export const provenanceSchema = z
  .object({
    classification: truthClassificationSchema,
    sourceTitle: shortTextSchema.optional(),
    sourceUrl: safeHttpsUrlSchema.optional(),
    publicationDate: z.iso.date().optional(),
    eventDate: z.iso.date().optional(),
    retrievedAt: z.iso.datetime({ offset: true }).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const runtimeArtifactSchema = z
  .object({
    id: idSchema,
    kind: idSchema,
    value: jsonValueSchema,
    truth: truthClassificationSchema,
    provenance: provenanceSchema.optional(),
    revision: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const runtimeFindingSchema = z
  .object({
    id: idSchema,
    kind: idSchema,
    severity: z.enum(['info', 'warning', 'blocking']),
    title: shortTextSchema,
    summary: textSchema,
    confidence: z.number().min(0).max(1).optional(),
    details: jsonObjectSchema.optional(),
    truth: truthClassificationSchema,
  })
  .strict();

export const connectorStateSchema = z
  .object({
    connectorId: idSchema,
    status: z.enum([
      'idle',
      'running',
      'available',
      'stale',
      'unavailable',
      'failed',
    ]),
    truth: truthClassificationSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    data: jsonObjectSchema.optional(),
    error: textSchema.optional(),
  })
  .strict();

export const publicAgentSummarySchema = z
  .object({
    summary: textSchema,
    evidence: z.array(shortTextSchema).max(16),
    selectedAction: idSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    providerId: idSchema.optional(),
    providerMode: z.enum(['live', 'deterministic_fallback']).optional(),
    model: idSchema.optional(),
  })
  .strict();

export const pendingDecisionSchema = z
  .object({
    decisionId: idSchema,
    title: shortTextSchema,
    explanation: textSchema,
    actions: z.array(allowedActionSchema).min(1).max(16),
    expectedRevision: z.number().int().nonnegative(),
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const runtimeUISectionSchema = z
  .object({
    id: idSchema,
    type: runtimeSectionTypeSchema,
    title: shortTextSchema.optional(),
    description: textSchema.optional(),
    truth: truthClassificationSchema.optional(),
    data: jsonObjectSchema,
  })
  .strict();

export const runtimeUISpecSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    flowVersion: z.number().int().positive(),
    layout: z.enum(['focus', 'split', 'timeline', 'receipt', 'generic']),
    priority: z.enum(['low', 'normal', 'high', 'critical']),
    ownership: z.enum(['agent', 'human', 'system', 'shared']),
    focusTarget: idSchema.optional(),
    truthContext: z.array(truthClassificationSchema).max(TRUTH_CLASSIFICATIONS.length),
    sections: z.array(runtimeUISectionSchema).min(1).max(32),
    allowedActions: z.array(allowedActionSchema).max(16),
  })
  .strict()
  .superRefine((spec, context) => {
    const sectionIds = spec.sections.map((section) => section.id);
    if (new Set(sectionIds).size !== sectionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'Section IDs must be unique',
      });
    }
    const actionIds = spec.allowedActions.map((action) => action.actionId);
    if (new Set(actionIds).size !== actionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['allowedActions'],
        message: 'Action IDs must be unique',
      });
    }
  });

export const runEventSchema = z
  .object({
    eventId: idSchema,
    runId: idSchema,
    sequence: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    timestamp: z.iso.datetime({ offset: true }),
    type: z.enum(RUN_EVENT_TYPES),
    stepId: idSchema.optional(),
    payload: jsonObjectSchema,
    truth: truthClassificationSchema,
  })
  .strict();

export const runSnapshotSchema = z
  .object({
    runId: idSchema,
    flowId: idSchema,
    flowVersion: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    lastSequence: z.number().int().nonnegative(),
    status: z.enum(RUN_STATUSES),
    currentStepId: idSchema.nullable(),
    completedStepIds: z.array(idSchema).max(64),
    skippedStepIds: z.array(idSchema).max(64),
    pendingDecision: pendingDecisionSchema.nullable(),
    artifacts: z.record(idSchema, runtimeArtifactSchema),
    findings: z.array(runtimeFindingSchema).max(128),
    connectorStates: z.record(idSchema, connectorStateSchema),
    publicAgentSummary: publicAgentSummarySchema.nullable(),
    timestamps: z
      .object({
        createdAt: z.iso.datetime({ offset: true }),
        updatedAt: z.iso.datetime({ offset: true }),
        completedAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict(),
    latestUISpec: runtimeUISpecSchema.nullable(),
    processedEventIds: z.array(idSchema).max(4_096),
    processedIdempotencyKeys: z.array(idSchema).max(4_096),
  })
  .strict();

export const humanActionSchema = z
  .object({
    runId: idSchema,
    decisionId: idSchema,
    actionId: idSchema,
    expectedRevision: z.number().int().nonnegative(),
    idempotencyKey: idSchema,
    input: jsonObjectSchema.optional(),
  })
  .strict();

export const flowMutationSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    operation: z.literal('insert-step'),
    expectedFlowVersion: z.number().int().positive(),
    step: stepDefinitionSchema,
    position: z
      .object({
        afterStepId: idSchema.optional(),
        beforeStepId: idSchema.optional(),
        after: idSchema.optional(),
        before: idSchema.optional(),
      })
      .strict()
      .superRefine((position, context) => {
        const after = position.afterStepId ?? position.after;
        const before = position.beforeStepId ?? position.before;
        if (!after && !before) {
          context.addIssue({
            code: 'custom',
            message: 'Specify at least one insertion anchor',
          });
        }
        if (
          position.afterStepId &&
          position.after &&
          position.afterStepId !== position.after
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Conflicting after anchors are not allowed',
          });
        }
        if (
          position.beforeStepId &&
          position.before &&
          position.beforeStepId !== position.before
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Conflicting before anchors are not allowed',
          });
        }
      })
      .transform((position) => ({
        ...((position.afterStepId ?? position.after)
          ? { afterStepId: position.afterStepId ?? position.after }
          : {}),
        ...((position.beforeStepId ?? position.before)
          ? { beforeStepId: position.beforeStepId ?? position.before }
          : {}),
      })),
    instruction: textSchema.max(1_000).optional(),
  })
  .strict();

export function assertBoundedJson(value: unknown): asserts value is JsonValue {
  jsonValueSchema.parse(value);
}
