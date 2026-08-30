import type { ComponentType } from 'react';
import type { RuntimeSectionType } from '@/lib/runtime/contracts';
import {
  ActionResultSection,
  AlertSection,
  BookingSection,
  ConfidenceSection,
  ContainerSection,
  DecisionSection,
  DiscrepancySection,
  DocumentComparisonSection,
  EventFeedSection,
  EvidenceSection,
  GenericStepSection,
  ProgressSection,
  QuoteSection,
  RefundSection,
  RouteMapSection,
  type RuntimeSectionComponentProps,
} from './runtime-primitives';

/**
 * This finite registry is the only bridge between semantic runtime output and React.
 * Flow IDs, step IDs, titles, and agent prose never select implementation code.
 */
export const componentRegistry: Readonly<
  Record<RuntimeSectionType, ComponentType<RuntimeSectionComponentProps>>
> = Object.freeze({
  'route-map': RouteMapSection,
  booking: BookingSection,
  container: ContainerSection,
  progress: ProgressSection,
  alert: AlertSection,
  evidence: EvidenceSection,
  quote: QuoteSection,
  refund: RefundSection,
  'document-comparison': DocumentComparisonSection,
  discrepancy: DiscrepancySection,
  confidence: ConfidenceSection,
  decision: DecisionSection,
  'action-result': ActionResultSection,
  'event-feed': EventFeedSection,
  'generic-step': GenericStepSection,
});

export function resolveRuntimeComponent(type: RuntimeSectionType) {
  return componentRegistry[type] ?? GenericStepSection;
}
