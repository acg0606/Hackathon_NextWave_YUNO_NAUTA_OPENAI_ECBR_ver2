'use client';

import { Braces, Check, FlaskConical, Sparkles, X } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

const trialInstruction = 'Validate Bill of Lading against booking before confirming.';

function trialMutationJson(flowVersion: number) {
  return JSON.stringify({
    schemaVersion: '1.0',
    operation: 'insert-step',
    expectedFlowVersion: flowVersion,
    step: {
      schemaVersion: '1.0',
      id: `step-${crypto.randomUUID()}`,
      title: 'Validate Bill of Lading against booking before confirming',
      description: 'Compare the issued Bill of Lading with the booking and pause for blocking differences.',
      kind: 'validate',
      capabilities: ['document.view', 'document.compare', 'decision.request'],
      owner: 'agent',
      when: {
        all: [{
          path: 'shipment.transportMode',
          operator: 'in',
          value: ['OCEAN', 'OCEAN_ROAD', 'RAIL_OCEAN'],
        }],
      },
      inputRefs: {
        expected: 'artifacts.booking',
        actual: 'artifacts.billOfLading',
      },
      tool: { id: 'mock.document.compare' },
      transitions: [
        { outcome: 'match', toStepId: 'confirm-booking' },
        { outcome: 'mismatch', toStepId: null },
      ],
    },
    position: {
      after: 'prepare-booking',
      before: 'confirm-booking',
    },
  }, null, 2);
}

export type FlowMutationRequest =
  | { instruction: string }
  | { mutation: unknown };

export type FlowMutationLabProps = {
  runId: string;
  flowVersion: number;
  disabled?: boolean;
  state?: 'idle' | 'submitting' | 'accepted' | 'error';
  message?: string | null;
  onMutate: (request: FlowMutationRequest) => void;
};

export function FlowMutationLab({
  runId,
  flowVersion,
  disabled = false,
  state = 'idle',
  message,
  onMutate,
}: FlowMutationLabProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'instruction' | 'json'>('instruction');
  const [value, setValue] = useState(trialInstruction);
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    if (!value.trim()) {
      setLocalError('Describe the step to insert before submitting.');
      return;
    }
    if (mode === 'instruction') {
      onMutate({ instruction: value.trim() });
      return;
    }
    try {
      onMutate({ mutation: JSON.parse(value) as unknown });
    } catch {
      setLocalError('The step JSON is not valid. Correct it and try again.');
    }
  }

  return (
    <div className={`flow-mutation-lab${open ? ' is-open' : ''}`}>
      <button
        aria-expanded={open}
        className="flow-mutation-lab__trigger"
        disabled={disabled}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <FlaskConical aria-hidden="true" />
        <span><strong>Change the flow</strong><small>Judge trial · no rebuild</small></span>
        <Sparkles aria-hidden="true" />
      </button>

      {open ? (
        <aside className="flow-mutation-lab__panel" aria-labelledby="flow-lab-title">
          <header>
            <div>
              <span>Flow mutation lab</span>
              <h2 id="flow-lab-title">Insert work while this run is live.</h2>
              <p>RouteShift validates the instruction, discovers its capabilities, and composes a safe interface from the registry.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close flow mutation lab"><X /></button>
          </header>

          <div className="flow-mutation-lab__identity">
            <span>Run <strong>{runId.slice(0, 12)}</strong></span>
            <span>Current flow <strong>v{flowVersion}</strong></span>
          </div>

          <fieldset className="flow-mutation-lab__mode">
            <legend className="sr-only">Mutation input format</legend>
            <button aria-pressed={mode === 'instruction'} type="button" onClick={() => { setMode('instruction'); setValue(trialInstruction); }}>
              <Sparkles aria-hidden="true" /> Natural language
            </button>
            <button aria-pressed={mode === 'json'} type="button" onClick={() => { setMode('json'); setValue(trialMutationJson(flowVersion)); }}>
              <Braces aria-hidden="true" /> Validated JSON
            </button>
          </fieldset>

          <form onSubmit={submit}>
            <label htmlFor="flow-mutation-input">
              {mode === 'instruction' ? 'Instruction for Ari' : 'Strict FlowMutation JSON'}
            </label>
            <textarea
              id="flow-mutation-input"
              rows={mode === 'instruction' ? 4 : 10}
              spellCheck={mode === 'instruction'}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <p className="flow-mutation-lab__boundary">No JSX, HTML, CSS, imports, scripts, or arbitrary tools are accepted.</p>
            {localError || (state === 'error' && message) ? (
              <p className="flow-mutation-lab__error" role="alert">{localError ?? message}</p>
            ) : null}
            {state === 'accepted' ? (
              <output className="flow-mutation-lab__success"><Check aria-hidden="true" /> {message ?? 'Flow mutation accepted. Watch the event stream.'}</output>
            ) : null}
            <button className="runtime-button runtime-button--primary" disabled={disabled || state === 'submitting'} type="submit">
              {state === 'submitting' ? 'Validating mutation…' : 'Insert step into this run'}
              <Sparkles aria-hidden="true" />
            </button>
          </form>
        </aside>
      ) : null}
    </div>
  );
}

export default FlowMutationLab;
