'use client';

import { useEffect, useRef } from 'react';
import { Check, Sparkles } from 'lucide-react';
import type { AllowedAction, RuntimeUISpec } from '@/lib/runtime/contracts';
import { resolveRuntimeComponent } from './component-registry';
import {
  RuntimeActionFallback,
  type RuntimeActionContext,
} from './runtime-primitives';

export type RuntimeRendererProps = {
  spec: RuntimeUISpec;
  currentStepId?: string | null;
  pendingActionId?: string | null;
  proofOfRecomposition?: boolean;
  onAction: (action: AllowedAction, context?: RuntimeActionContext) => void;
};

export function RuntimeRenderer({
  spec,
  currentStepId,
  pendingActionId,
  proofOfRecomposition = false,
  onAction,
}: RuntimeRendererProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hasDecisionSection = spec.sections.some((section) => section.type === 'decision');

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const targets = Array.from(surface.querySelectorAll<HTMLElement>('[data-section-id]'));
    const requested = spec.focusTarget
      ? targets.find((target) => target.dataset.sectionId === spec.focusTarget)
      : null;
    const focusTarget = requested ?? surface.querySelector<HTMLElement>('h1, h2');
    if (!focusTarget) return;
    focusTarget.tabIndex = -1;
    focusTarget.focus({ preventScroll: true });
  }, [spec.focusTarget, spec.revision]);

  return (
    <div
      className={`runtime-renderer runtime-renderer--${spec.layout} runtime-renderer--${spec.priority}`}
      data-flow-version={spec.flowVersion}
      data-revision={spec.revision}
      data-runtime-ownership={spec.ownership}
      key={`${spec.runId}:${spec.revision}:${currentStepId ?? 'idle'}`}
      ref={surfaceRef}
    >
      {proofOfRecomposition ? (
        <output className="recomposition-proof">
          <Sparkles aria-hidden="true" />
          <span><Check aria-hidden="true" /> Flow changed</span>
          <i aria-hidden="true" />
          <span><Check aria-hidden="true" /> Ari understood</span>
          <i aria-hidden="true" />
          <span><Check aria-hidden="true" /> UI recomposed</span>
          <small>Flow v{spec.flowVersion} · revision {spec.revision}</small>
        </output>
      ) : null}

      <div className="runtime-section-grid">
        {spec.sections.map((section) => {
          const Component = resolveRuntimeComponent(section.type);
          return (
            <Component
              key={section.id}
              onAction={onAction}
              pendingActionId={pendingActionId}
              section={section}
              spec={spec}
            />
          );
        })}
      </div>

      {!hasDecisionSection && spec.allowedActions.length > 0 ? (
        <RuntimeActionFallback
          onAction={onAction}
          pendingActionId={pendingActionId}
          spec={spec}
        />
      ) : null}
    </div>
  );
}

export default RuntimeRenderer;
