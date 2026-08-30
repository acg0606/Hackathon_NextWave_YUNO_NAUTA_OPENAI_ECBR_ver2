export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export const TRUTH_CLASSIFICATIONS = [
  'HISTORICAL_FACT',
  'LIVE_CURRENT_CONTEXT',
  'EXTERNAL_SANDBOX',
  'SIMULATED_IF_TODAY',
  'MOCK_CONNECTOR',
  'UNKNOWN',
] as const;

export type TruthClassification = (typeof TRUTH_CLASSIFICATIONS)[number];

export const STEP_KINDS = [
  'extract',
  'monitor',
  'validate',
  'decide',
  'notify',
  'fulfill',
  'generic',
] as const;

export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_OWNERS = ['agent', 'human', 'system'] as const;

export type StepOwner = (typeof STEP_OWNERS)[number];

export const STEP_CAPABILITIES = [
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
] as const;

export type StepCapability = (typeof STEP_CAPABILITIES)[number];

export const TOOL_IDS = [
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
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in'
  | 'exists'
  | 'not_exists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';

export interface ConditionPredicate {
  path: string;
  operator: ConditionOperator;
  value?: JsonValue;
}

export interface StepCondition {
  all?: ConditionPredicate[];
  any?: ConditionPredicate[];
}

export interface StepTool {
  id: ToolId;
  parameters?: JsonObject;
}

export interface StepTransitionRule {
  outcome: string;
  toStepId: string | null;
}

export interface StepPresentationHints {
  priority?: 'low' | 'normal' | 'high' | 'critical';
  layout?: 'focus' | 'split' | 'timeline' | 'receipt' | 'generic';
  focus?: StepCapability;
  preferredSections?: RuntimeSectionType[];
}

export interface StepRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface StepDefinition {
  schemaVersion: '1.0';
  id: string;
  title: string;
  description: string;
  kind: StepKind;
  capabilities: StepCapability[];
  owner: StepOwner;
  when?: StepCondition;
  inputRefs?: Record<string, string>;
  tool?: StepTool;
  transitions?: StepTransitionRule[];
  presentation?: StepPresentationHints;
  timeoutMs?: number;
  retry?: StepRetryPolicy;
}

export interface FlowTransition {
  fromStepId: string;
  outcome: string;
  toStepId: string | null;
}

export interface FlowDefinition {
  schemaVersion: '1.0';
  id: string;
  version: number;
  name: string;
  description: string;
  entryStepId: string;
  steps: StepDefinition[];
  transitions: FlowTransition[];
  metadata: JsonObject;
}

export interface Provenance {
  classification: TruthClassification;
  sourceTitle?: string;
  sourceUrl?: string;
  publicationDate?: string;
  eventDate?: string;
  retrievedAt?: string;
  confidence?: number;
}

export interface RuntimeArtifact {
  id: string;
  kind: string;
  value: JsonValue;
  truth: TruthClassification;
  provenance?: Provenance;
  revision: number;
  updatedAt: string;
}

export interface RuntimeFinding {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  summary: string;
  confidence?: number;
  details?: JsonObject;
  truth: TruthClassification;
}

export interface ConnectorState {
  connectorId: string;
  status: 'idle' | 'running' | 'available' | 'stale' | 'unavailable' | 'failed';
  truth: TruthClassification;
  updatedAt: string;
  data?: JsonObject;
  error?: string;
}

export interface PublicAgentSummary {
  summary: string;
  evidence: string[];
  selectedAction?: string;
  confidence?: number;
  providerId?: string;
  providerMode?: 'live' | 'deterministic_fallback';
  model?: string;
}

export const RUNTIME_ACTION_INTENTS = [
  'request-corrected-document',
  'approve-exception',
  'reroute',
  'hold',
  'release',
  'escalate',
  'confirm',
  'retry',
  'continue',
  'dismiss',
  'select',
] as const;

export type RuntimeActionIntent = (typeof RUNTIME_ACTION_INTENTS)[number];

export interface AllowedAction {
  actionId: string;
  label: string;
  intent: RuntimeActionIntent;
  requiresConfirmation?: boolean;
  inputSchema?: JsonObject;
}

export interface PendingDecision {
  decisionId: string;
  title: string;
  explanation: string;
  actions: AllowedAction[];
  expectedRevision: number;
  requestedAt: string;
}

export const RUNTIME_SECTION_TYPES = [
  'route-map',
  'booking',
  'container',
  'progress',
  'alert',
  'evidence',
  'quote',
  'refund',
  'document-comparison',
  'discrepancy',
  'confidence',
  'decision',
  'action-result',
  'event-feed',
  'generic-step',
] as const;

export type RuntimeSectionType = (typeof RUNTIME_SECTION_TYPES)[number];

export interface RuntimeUISection {
  id: string;
  type: RuntimeSectionType;
  title?: string;
  description?: string;
  truth?: TruthClassification;
  data: JsonObject;
}

export type RuntimeUILayout =
  | 'focus'
  | 'split'
  | 'timeline'
  | 'receipt'
  | 'generic';

export type RuntimeUIPriority = 'low' | 'normal' | 'high' | 'critical';

export type RuntimeUIOwnership = 'agent' | 'human' | 'system' | 'shared';

export interface RuntimeUISpec {
  schemaVersion: '1.0';
  runId: string;
  revision: number;
  flowVersion: number;
  layout: RuntimeUILayout;
  priority: RuntimeUIPriority;
  ownership: RuntimeUIOwnership;
  focusTarget?: string;
  truthContext: TruthClassification[];
  sections: RuntimeUISection[];
  allowedActions: AllowedAction[];
}

export const RUN_EVENT_TYPES = [
  'run.created',
  'flow.loaded',
  'flow.definition.updated',
  'step.discovered',
  'step.started',
  'step.skipped',
  'step.completed',
  'step.failed',
  'artifact.upserted',
  'artifact.invalidated',
  'tool.call.started',
  'tool.call.completed',
  'tool.call.failed',
  'connector.call.started',
  'connector.call.completed',
  'connector.call.failed',
  'agent.summary.updated',
  'finding.recorded',
  'decision.requested',
  'run.awaiting_human',
  'human.action.received',
  'run.resumed',
  'ui.spec.emitted',
  'run.completed',
  'run.failed',
  'run.cancelled',
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export interface RunEvent {
  eventId: string;
  runId: string;
  sequence: number;
  revision: number;
  timestamp: string;
  type: RunEventType;
  stepId?: string;
  payload: JsonObject;
  truth: TruthClassification;
}

export const RUN_STATUSES = [
  'queued',
  'running',
  'awaiting_human',
  'completed',
  'failed',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunTimestamps {
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface RunSnapshot {
  runId: string;
  flowId: string;
  flowVersion: number;
  revision: number;
  lastSequence: number;
  status: RunStatus;
  currentStepId: string | null;
  completedStepIds: string[];
  skippedStepIds: string[];
  pendingDecision: PendingDecision | null;
  artifacts: Record<string, RuntimeArtifact>;
  findings: RuntimeFinding[];
  connectorStates: Record<string, ConnectorState>;
  publicAgentSummary: PublicAgentSummary | null;
  timestamps: RunTimestamps;
  latestUISpec: RuntimeUISpec | null;
  processedEventIds: string[];
  processedIdempotencyKeys: string[];
}

export interface HumanAction {
  runId: string;
  decisionId: string;
  actionId: string;
  expectedRevision: number;
  idempotencyKey: string;
  input?: JsonObject;
}

export interface FlowMutationPosition {
  afterStepId?: string;
  beforeStepId?: string;
}

export interface FlowMutation {
  schemaVersion: '1.0';
  operation: 'insert-step';
  expectedFlowVersion: number;
  step: StepDefinition;
  position: FlowMutationPosition;
  instruction?: string;
}
