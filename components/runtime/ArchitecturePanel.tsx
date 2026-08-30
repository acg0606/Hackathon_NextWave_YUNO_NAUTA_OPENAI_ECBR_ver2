'use client';

import {
  ArrowRight,
  Boxes,
  Cpu,
  Database,
  GitBranch,
  Network,
  PanelTop,
  Radio,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type {
  RunStatus,
  RuntimeUIOwnership,
  TruthClassification,
} from '@/lib/runtime/contracts';
import { TruthBadge } from './runtime-primitives';

type RuntimeProof = {
  runId: string;
  flowVersion: number;
  revision: number;
  status: RunStatus;
  currentStepId: string | null;
  owner: RuntimeUIOwnership;
};

export type ArchitecturePanelProps = {
  open: boolean;
  onClose: () => void;
  runtimeProof?: RuntimeProof | null;
};

const flowStages = [
  ['01', 'FlowDefinition', 'Validated work contract'],
  ['02', 'FlowEngine + agent', 'Conditions, tools, ownership'],
  ['03', 'RunEvent', 'Append-only public facts'],
  ['04', 'Pure reducer', 'Deterministic event fold'],
  ['05', 'RunSnapshot', 'Materialized run truth'],
  ['06', 'UI compiler', 'State becomes semantic intent'],
  ['07', 'RuntimeUISpec', 'Strict allowlisted schema'],
  ['08', 'Component registry', 'Finite safe primitives'],
  ['09', 'RuntimeRenderer', 'Operational surface'],
  ['10', 'HumanAction', 'Same run pauses and resumes'],
] as const;

const architectureLayers = [
  {
    title: 'Experience',
    eyebrow: 'Browser',
    icon: PanelTop,
    items: [
      'RouteShiftRuntime',
      'Real Earth route view',
      'Generated operating surface',
      'Public event feed',
    ],
  },
  {
    title: 'Streaming boundary',
    eyebrow: 'HTTP + SSE',
    icon: Radio,
    items: [
      'Run creation and snapshots',
      'Last-Event-ID replay',
      'Human actions',
      'Live flow mutation',
    ],
  },
  {
    title: 'Deterministic core',
    eyebrow: 'Runtime',
    icon: Cpu,
    items: [
      'Per-run serialized engine',
      'Append-only event store',
      'Pure reducer',
      'Semantic UI compiler',
    ],
  },
  {
    title: 'Intelligence',
    eyebrow: 'Agent',
    icon: GitBranch,
    items: [
      'OpenAI structured output',
      'Deterministic fallback',
      'Validated findings only',
      'No generated code or private reasoning',
    ],
  },
  {
    title: 'Operational context',
    eyebrow: 'Connectors',
    icon: Network,
    items: [
      'Yuno Sandbox',
      'AISStream + ADSB.lol',
      'NASA EONET',
      'Nauta visibility mock',
    ],
  },
] as const;

const truthBoundaries: Array<{
  title: string;
  truth: TruthClassification;
  description: string;
}> = [
  {
    title: 'Historical disruption archive',
    truth: 'HISTORICAL_FACT',
    description:
      'Dated evidence with curated provenance. It never claims to describe the present.',
  },
  {
    title: 'Present-day traffic and hazards',
    truth: 'LIVE_CURRENT_CONTEXT',
    description:
      'Current AIS, aviation, and EONET context with timestamps and unavailable states.',
  },
  {
    title: 'What-if operational consequences',
    truth: 'SIMULATED_IF_TODAY',
    description:
      'Route, ETA, document, cost, and interface changes calculated for the active run.',
  },
  {
    title: 'Yuno payment-link effects',
    truth: 'EXTERNAL_SANDBOX',
    description:
      'A real sandbox-side effect, isolated from production money movement.',
  },
  {
    title: 'Nauta logistics visibility',
    truth: 'MOCK_CONNECTOR',
    description:
      'Useful deterministic milestones and exceptions, explicitly presented as a mock.',
  },
];

export function ArchitecturePanel({
  open,
  onClose,
  runtimeProof,
}: ArchitecturePanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.scrollTop = 0;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      window.requestAnimationFrame(() =>
        dialog.querySelector<HTMLButtonElement>('button')?.focus(),
      );
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  useEffect(() => () => previousFocusRef.current?.focus(), []);

  return (
    <dialog
      aria-describedby="architecture-panel-description"
      aria-labelledby="architecture-panel-title"
      className="architecture-panel"
      id="runtime-architecture-panel"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => previousFocusRef.current?.focus()}
    >
      <header className="architecture-panel__header">
        <div>
          <span>
            <Workflow aria-hidden="true" /> Runtime architecture
          </span>
          <h2 id="architecture-panel-title">
            The flow is the source of the experience.
          </h2>
          <p id="architecture-panel-description">
            Every visible surface is compiled from validated flow state, public
            events, and truth-classified evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close architecture and flow"
        >
          <X />
        </button>
      </header>

      {runtimeProof ? (
        <section
          className="architecture-proof"
          aria-label="Current runtime proof"
        >
          <div>
            <span>
              <Radio aria-hidden="true" /> Current runtime proof
            </span>
            <strong>{runtimeProof.status.replaceAll('_', ' ')}</strong>
          </div>
          <dl>
            <div>
              <dt>Run ID</dt>
              <dd>{runtimeProof.runId}</dd>
            </div>
            <div>
              <dt>Flow</dt>
              <dd>v{runtimeProof.flowVersion}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{runtimeProof.revision}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{runtimeProof.owner}</dd>
            </div>
            <div>
              <dt>Active step</dt>
              <dd>{runtimeProof.currentStepId ?? 'Run complete'}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <section
          className="architecture-proof architecture-proof--empty"
          aria-label="Runtime proof unavailable"
        >
          <Database aria-hidden="true" /> Start or select a run to attach live
          execution proof to this diagram.
        </section>
      )}

      <section
        className="architecture-panel__section"
        aria-labelledby="runtime-flow-title"
      >
        <div className="architecture-section-heading">
          <div>
            <span>01 · Runtime sequence</span>
            <h3 id="runtime-flow-title">One run, progressively recomposed</h3>
          </div>
          <p>
            Flow mutations and human decisions generate new events; they never
            rotate independent hardcoded screens.
          </p>
        </div>
        <ol className="architecture-flow">
          {flowStages.map(([number, title, description]) => (
            <li key={number}>
              <span>{number}</span>
              <strong>{title}</strong>
              <small>{description}</small>
              {number !== '10' ? (
                <ArrowRight aria-hidden="true" />
              ) : (
                <Users aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
        <div className="architecture-loop-proof">
          <ShieldCheck aria-hidden="true" />
          <p>
            <strong>Same-run continuation:</strong> a decision pauses the
            current run, validates an idempotent HumanAction, then resumes that
            exact runId with a higher revision.
          </p>
        </div>
      </section>

      <section
        className="architecture-panel__section"
        aria-labelledby="system-layers-title"
      >
        <div className="architecture-section-heading">
          <div>
            <span>02 · System layers</span>
            <h3 id="system-layers-title">
              From browser intent to governed external context
            </h3>
          </div>
          <p>
            The finite registry is the safety boundary: agents describe semantic
            intent, never JSX, CSS, imports, or arbitrary components.
          </p>
        </div>
        <div className="architecture-layers">
          {architectureLayers.map((layer, index) => {
            const Icon = layer.icon;
            return (
              <article key={layer.title}>
                <div className="architecture-layer__index">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <Icon aria-hidden="true" />
                <span>{layer.eyebrow}</span>
                <h4>{layer.title}</h4>
                <ul>
                  {layer.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {index < architectureLayers.length - 1 ? (
                  <ArrowRight
                    className="architecture-layer__arrow"
                    aria-hidden="true"
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="architecture-panel__section"
        aria-labelledby="truth-boundaries-title"
      >
        <div className="architecture-section-heading">
          <div>
            <span>03 · Truth model</span>
            <h3 id="truth-boundaries-title">
              Evidence cannot silently change category
            </h3>
          </div>
          <p>
            Every connector result, event, and UI section carries one canonical
            classification.
          </p>
        </div>
        <div className="architecture-truth-grid">
          {truthBoundaries.map((boundary) => (
            <article key={boundary.truth}>
              <div>
                <Boxes aria-hidden="true" />
                <TruthBadge truth={boundary.truth} />
              </div>
              <h4>{boundary.title}</h4>
              <p>{boundary.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="architecture-panel__footer">
        <GitBranch aria-hidden="true" />
        <p>
          <strong>FLOW CHANGED</strong>
          <span>→</span>
          <strong>ARI UNDERSTOOD</strong>
          <span>→</span>
          <strong>UI RECOMPOSED</strong>
        </p>
        <small>
          Proven by flow.definition.updated, step.discovered, and
          ui.spec.updated events.
        </small>
      </footer>
    </dialog>
  );
}

export default ArchitecturePanel;
