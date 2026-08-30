export type InferredStepKind =
  | 'extract'
  | 'monitor'
  | 'validate'
  | 'decide'
  | 'notify'
  | 'fulfill'
  | 'generic';

export type InferredCapability =
  | 'route.view'
  | 'booking.view'
  | 'container.track'
  | 'document.view'
  | 'document.compare'
  | 'incident.explain'
  | 'quote.view'
  | 'refund.view'
  | 'decision.request'
  | 'notification.view'
  | 'delivery.confirm'
  | 'audit.view';

export type SemanticStepIntent = {
  title: string;
  description: string;
  kind: InferredStepKind;
  capabilities: InferredCapability[];
  owner: 'agent' | 'human' | 'system';
  tool?: string;
  after?: string;
  before?: string;
  condition?: {
    path: string;
    operator: 'in' | 'equals' | 'exists';
    value?: string | string[] | boolean;
  };
  inputRefs?: Record<string, string>;
  transitions?: Record<string, string>;
};

export type DocumentDifference = {
  field: string;
  expected: string | number | boolean | null;
  actual: string | number | boolean | null;
  blocking: boolean;
  delta?: number;
  deltaPercent?: number;
};

export type DocumentComparison = {
  matches: boolean;
  confidence: number;
  differences: DocumentDifference[];
  recommendedAction: 'continue' | 'request-corrected-document' | 'approve-exception';
  publicSummary: string;
};

export type PublicAgentSummary = {
  summary: string;
  evidence: string[];
  confidence: number;
  selectedAction?: string;
  providerId?: string;
  providerMode?: 'live' | 'deterministic_fallback';
  model?: string;
};

export type AgentFallbackReason =
  | 'not_configured'
  | 'provider_timeout'
  | 'authentication_failed'
  | 'insufficient_quota'
  | 'rate_limited'
  | 'access_denied'
  | 'transport_unavailable'
  | 'provider_unavailable'
  | 'invalid_output';

export type AgentInferenceTelemetry = {
  providerId: string;
  providerMode: 'live' | 'deterministic_fallback';
  structuredOutput: boolean;
  model?: string;
  fallbackReason?: AgentFallbackReason;
  providerStatus?: number;
};

export type SemanticStepInference = {
  intent: SemanticStepIntent | null;
  telemetry: AgentInferenceTelemetry;
};

export interface AgentProvider {
  readonly id: string;
  readonly deterministic: boolean;

  inferStep(instruction: string): Promise<SemanticStepIntent | null>;

  inferStepWithTelemetry?(instruction: string): Promise<SemanticStepInference>;

  compareDocuments(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
  ): Promise<DocumentComparison>;

  summarize(input: {
    objective: string;
    evidence: string[];
    confidence?: number;
    selectedAction?: string;
  }): Promise<PublicAgentSummary>;
}
