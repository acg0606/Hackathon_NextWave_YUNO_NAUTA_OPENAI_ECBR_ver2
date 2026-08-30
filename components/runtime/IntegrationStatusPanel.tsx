'use client';

import { Activity, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ConnectorState, TruthClassification } from '@/lib/runtime/contracts';
import { TruthBadge } from './runtime-primitives';

type ServiceStatus = {
  id: string;
  label: string;
  configured: boolean;
  available: boolean | null;
  mode: string;
  fallbackActive: boolean;
  lastSuccessAt: string | null;
  latencyMs: number | null;
  truth: TruthClassification;
  publicNote: string;
};

type StatusResponse = {
  generatedAt: string;
  secretsExposed: false;
  services: ServiceStatus[];
};

export type IntegrationStatusPanelProps = {
  open: boolean;
  onClose: () => void;
  agentProvider?: {
    providerId?: string;
    providerMode?: 'live' | 'deterministic_fallback';
    model?: string;
  } | null;
  connectorStates?: Record<string, ConnectorState>;
};

export function IntegrationStatusPanel({
  open,
  onClose,
  agentProvider,
  connectorStates = {},
}: IntegrationStatusPanelProps) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch('/api/integrations/status', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Integration status returned ${response.status}.`);
        return response.json() as Promise<StatusResponse>;
      })
      .then((nextStatus) => {
        setError(null);
        setStatus(nextStatus);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Integration status is unavailable.');
        }
      });
    return () => controller.abort();
  }, [open, refresh]);

  if (!open) return null;

  return (
    <aside className="integration-status-panel" aria-labelledby="integration-status-title">
      <header>
        <div>
          <span><Activity aria-hidden="true" /> Integration truth</span>
          <h2 id="integration-status-title">What is genuinely external right now?</h2>
          <p>Configuration, live observations, sandbox effects, and mocks remain separate.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close integration truth panel"><X /></button>
      </header>

      {error ? <p className="integration-status-panel__error" role="alert">{error}</p> : null}
      {!status && !error ? <p className="integration-status-panel__loading">Reading server-side capability status…</p> : null}
      {status ? (
        <ul>
          {status.services.map((service) => {
            const observedOpenAI = service.id === 'OPENAI' && agentProvider?.providerMode;
            const observedConnector = Object.values(connectorStates).find((connector) => {
              const id = connector.connectorId.toUpperCase();
              return id === service.id || (service.id === 'YUNO' && id.includes('YUNO'));
            });
            const truth = observedConnector?.truth ?? (
              observedOpenAI && agentProvider.providerMode === 'live'
                ? 'SIMULATED_IF_TODAY'
                : service.truth
            );
            const mode = observedConnector
              ? `observed ${observedConnector.status} · ${observedConnector.updatedAt}`
              : observedOpenAI
              ? agentProvider.providerMode === 'live'
                ? `observed live · ${agentProvider.model ?? agentProvider.providerId ?? 'OpenAI'}`
                : 'observed deterministic fallback'
              : service.mode.replaceAll('-', ' ');
            const health = service.available === true && service.lastSuccessAt
              ? `Verified ${new Date(service.lastSuccessAt).toLocaleTimeString()}${service.latencyMs !== null
                ? ` · ${service.latencyMs} ms`
                : ''}`
              : null;
            return (
              <li key={service.id}>
                <div>
                  <strong>{service.label}</strong>
                  <span>{mode}</span>
                </div>
                <TruthBadge truth={truth} />
                <p>{service.publicNote}</p>
                {health ? <small>{health}</small> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <footer>
        <ShieldCheck aria-hidden="true" /> No secret values are returned to this panel.
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>
          <RefreshCw aria-hidden="true" /> Refresh
        </button>
      </footer>
    </aside>
  );
}

export default IntegrationStatusPanel;
