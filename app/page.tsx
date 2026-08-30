'use client';

/**
 * DIRECTION CONTRACT — HORIZONTE DE LUZ
 * WORLD: a realistic Earth performs on an infinite cyclorama that moves from night to day.
 * SIGNATURE: the operating surface is replaced — never merely relabelled — at each logistics handoff.
 * TRUTH: historical fact, current context and simulated-if-today are visibly separated.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileCheck2,
  Gauge,
  MapPin,
  Navigation,
  Newspaper,
  PackageCheck,
  Pause,
  Plane,
  RefreshCw,
  Satellite,
  Search,
  ShieldCheck,
  Ship,
  Sparkles,
  TrainFront,
  Truck,
  X,
} from 'lucide-react';
import stageEnvironment from '../assets/plates/stage-environment.png';
import airInstrumentGhost from '../assets/plates/air-instrument-ghost.png';
import incidentPaper from '../assets/plates/incident-paper.png';
import { LiveEarth } from './LiveEarth';
import { modeLabel, scenarios, type Scenario, type TransportMode } from './scenarios';

type Stage =
  | 'order'
  | 'transit'
  | 'incident'
  | 'decision'
  | 'rerouted'
  | 'lastmile'
  | 'delivered';

const stages: { id: Stage; label: string }[] = [
  { id: 'order', label: 'Compra' },
  { id: 'transit', label: 'Em trânsito' },
  { id: 'incident', label: 'Incidente' },
  { id: 'decision', label: 'Decisão' },
  { id: 'rerouted', label: 'Nova rota' },
  { id: 'lastmile', label: 'Última milha' },
  { id: 'delivered', label: 'Entrega' },
];

const productOptions = Array.from(new Set([
  'Peça AOG · 180 kg',
  'Fármacos refrigerados · 420 kg',
  'Eletrônicos · 1×40′',
  'Máquina industrial · 1×40′',
  'Vestuário · 1×40′',
  ...scenarios.map((scenario) => scenario.product),
]));

const promiseOptions = Array.from(new Set([
  '14 horas',
  '24 horas',
  '7 dias',
  '18 dias',
  '30 dias',
  ...scenarios.map((scenario) => scenario.promise),
]));

type LiveStatus = 'loading' | 'ready' | 'unavailable';

function routeWithDestination(route: string[], destination: string) {
  if (route.length === 0) return [destination];
  return [...route.slice(0, -1), destination];
}

function ModeGlyph({ mode }: { mode: TransportMode }) {
  if (mode === 'AIR') return <Plane aria-hidden="true" />;
  if (mode === 'RAIL_OCEAN') return <TrainFront aria-hidden="true" />;
  if (mode === 'OCEAN_ROAD') return <Truck aria-hidden="true" />;
  return <Ship aria-hidden="true" />;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function Brand() {
  return (
    <div className="brand-lockup" aria-label="RouteShift by JAIGO">
      <span>
        ROUTE<span>SHIFT</span>
      </span>
      <small>by JAIGO</small>
    </div>
  );
}

function TruthTag({ kind }: { kind: 'FACT' | 'LIVE' | 'SIMULATION' | 'MOCK' | 'UNKNOWN' }) {
  const labels = {
    FACT: 'FATO HISTÓRICO',
    LIVE: 'CONTEXTO ATUAL',
    SIMULATION: 'SE FOSSE HOJE · SIMULAÇÃO',
    MOCK: 'CONECTOR MOCK',
    UNKNOWN: 'CONTEXTO INDISPONÍVEL',
  };
  return <span className={`truth-tag truth-tag--${kind.toLowerCase()}`}>{labels[kind]}</span>;
}

function ScenarioArchive({
  selected,
  onSelect,
  onClose,
}: {
  selected: Scenario;
  onSelect: (scenario: Scenario) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const filtered = scenarios.filter((scenario) =>
    `${scenario.shortName} ${scenario.category} ${scenario.place}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => dialog.querySelector<HTMLInputElement>('input')?.focus());
    }
    return () => {
      if (dialog?.open) dialog.close();
      previousFocus?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="scenario-archive"
      aria-labelledby="archive-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
        <header className="archive-header">
          <div>
            <span className="eyebrow">ARQUIVO DE DISRUPÇÕES</span>
            <h2 id="archive-title">Escolha um passado. Rode-o no presente.</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar arquivo">
            <X />
          </button>
        </header>

        <label className="archive-search">
          <Search aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar evento, lugar ou modal"
          />
        </label>

        <div className="scenario-grid">
          {filtered.map((scenario, index) => (
            <button
              key={scenario.id}
              className={`scenario-card${scenario.id === selected.id ? ' is-selected' : ''}`}
              type="button"
              onClick={() => onSelect(scenario)}
              style={{ '--scenario-accent': scenario.accent } as React.CSSProperties}
            >
              <span className="scenario-card__index">{String(index + 1).padStart(2, '0')}</span>
              <span className="scenario-card__year">{scenario.year}</span>
              <strong>{scenario.shortName}</strong>
              <span>{scenario.category}</span>
              <small>{scenario.place}</small>
              <span className="scenario-card__action">
                SIMULAR <ChevronRight aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>

        <footer className="archive-footer">
          <TruthTag kind="FACT" />
          <span>10 casos resolvidos · recomendações, custos e conectores são simulações.</span>
        </footer>
    </dialog>
  );
}

function MarketplaceSurface({
  scenario,
  product,
  promise,
  price,
  destinationLabel,
  destinationCoordinates,
  picking,
  onProduct,
  onPromise,
  onPickToggle,
  onCoordinates,
  onArchive,
  onCreate,
}: {
  scenario: Scenario;
  product: string;
  promise: string;
  price: number;
  destinationLabel: string;
  destinationCoordinates: [number, number];
  picking: boolean;
  onProduct: (value: string) => void;
  onPromise: (value: string) => void;
  onPickToggle: () => void;
  onCoordinates: (coordinates: [number, number]) => void;
  onArchive: () => void;
  onCreate: () => void;
}) {
  return (
    <section className="surface surface--marketplace" data-surface="marketplace" aria-labelledby="market-title">
      <div className="market-intro">
        <span className="eyebrow">CUE 01 · COMPRA</span>
        <h1 id="market-title">
          A mesma entrega.<br />
          <em>Outra cena.</em>
        </h1>
        <p>Crie uma entrega e depois faça um evento real do passado acontecer hoje.</p>
      </div>

      <div className="order-composer">
        <div className="order-composer__heading">
          <div>
            <span className="mini-label">ENTREGA SIMULADA</span>
            <strong>Monte a jornada</strong>
          </div>
          <button className="archive-trigger" type="button" onClick={onArchive}>
            <Newspaper aria-hidden="true" />
            {scenario.shortName}
            <span>{scenario.year}</span>
          </button>
        </div>

        <div className="route-fields">
          <div className="field-card">
            <MapPin aria-hidden="true" />
            <span><small>ORIGEM</small><strong>{scenario.origin}</strong></span>
          </div>
          <button
            className={`field-card field-card--button${picking ? ' is-picking' : ''}`}
            type="button"
            onClick={onPickToggle}
            aria-pressed={picking}
          >
            <Navigation aria-hidden="true" />
            <span><small>DESTINO · GLOBO OU COORDENADAS</small><strong>{destinationLabel}</strong></span>
          </button>
        </div>

        {picking && (
          <div className="coordinate-entry" aria-label="Definir destino por teclado">
            <label>
              <span>LATITUDE</span>
              <input
                type="number"
                min="-90"
                max="90"
                step="0.01"
                value={destinationCoordinates[1]}
                onChange={(event) => onCoordinates([
                  destinationCoordinates[0],
                  Math.max(-90, Math.min(90, Number(event.target.value))),
                ])}
              />
            </label>
            <label>
              <span>LONGITUDE</span>
              <input
                type="number"
                min="-180"
                max="180"
                step="0.01"
                value={destinationCoordinates[0]}
                onChange={(event) => onCoordinates([
                  Math.max(-180, Math.min(180, Number(event.target.value))),
                  destinationCoordinates[1],
                ])}
              />
            </label>
            <button type="button" onClick={onPickToggle}>CONCLUIR DESTINO</button>
          </div>
        )}

        <div className="select-row">
          <label>
            <Box aria-hidden="true" />
            <span>PRODUTO</span>
            <select value={product} onChange={(event) => onProduct(event.target.value)}>
              {productOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <Clock3 aria-hidden="true" />
            <span>PROMESSA</span>
            <select value={promise} onChange={(event) => onPromise(event.target.value)}>
              {promiseOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>

        <div className="quote-strip">
          <div><small>COTAÇÃO</small><strong>{formatUsd(price)}</strong></div>
          <div><small>MODAL</small><strong>{modeLabel[scenario.modeBefore]}</strong></div>
          <div><TruthTag kind="MOCK" /><span>Yuno · autorização preparada</span></div>
        </div>

        <button className="primary-action" type="button" onClick={onCreate}>
          COMPRAR ENTREGA <span>{formatUsd(price)}</span> <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function TransitSurface({
  scenario,
  product,
  promise,
  destination,
  onTrigger,
}: {
  scenario: Scenario;
  product: string;
  promise: string;
  destination: string;
  onTrigger: () => void;
}) {
  const isAir = scenario.modeBefore === 'AIR';
  const isRail = scenario.modeBefore === 'RAIL_OCEAN';
  const variant = isAir ? 'air' : isRail ? 'rail' : 'ocean';
  const route = routeWithDestination(scenario.routeBefore, destination);

  return (
    <section className={`surface surface--transit surface--${variant}`} data-surface={`${variant}-transit`} aria-labelledby="transit-title">
      <header className="provider-header">
        <div className="provider-mark"><ModeGlyph mode={scenario.modeBefore} /><span>{isAir ? 'AEROLINK' : isRail ? 'NORTHLINE' : 'BLUEWATER'}</span></div>
        <span className="interface-label">INTERFACE ATIVA · {modeLabel[scenario.modeBefore].toUpperCase()}</span>
      </header>

      <div className="transit-body">
        <div className="shipment-code">
          <span>{isAir ? 'AWB' : isRail ? 'WAYBILL' : 'CONTAINER'}</span>
          <strong>{isAir ? '020-7246 1984' : isRail ? 'RS-CP-044921' : 'RSYU 481 220-6'}</strong>
          <small>{product}</small>
        </div>
        <h2 id="transit-title">{scenario.origin} <ArrowRight /> {destination}</h2>
        <div className="modal-timeline">
          {route.map((stop, index) => (
            <div className={index === 0 ? 'is-complete' : index === 1 ? 'is-current' : ''} key={stop}>
              <span />
              <strong>{stop}</strong>
              <small>{index === 0 ? 'LIBERADO' : index === 1 ? 'EM CURSO' : 'PREVISTO'}</small>
            </div>
          ))}
        </div>
        <div className="local-provenance"><TruthTag kind="SIMULATION" /><span>ETA, fonte e status operacionais demonstrativos</span></div>
        <div className="instrument-row">
          <div><Gauge /><span>CONFIANÇA ETA</span><strong>94%</strong></div>
          <div><Satellite /><span>FONTE</span><strong>{scenario.trackerBefore}</strong></div>
          <div><Clock3 /><span>PROMESSA</span><strong>{promise}</strong></div>
        </div>
      </div>

      <button className="event-trigger" type="button" onClick={onTrigger}>
        <AlertTriangle aria-hidden="true" />
        ACIONAR {scenario.shortName.toUpperCase()} COMO SE FOSSE HOJE
        <ArrowRight aria-hidden="true" />
      </button>
    </section>
  );
}

function NewsroomSurface({
  scenario,
  liveCount,
  liveStatus,
  observedAt,
  onContinue,
}: {
  scenario: Scenario;
  liveCount: number | null;
  liveStatus: LiveStatus;
  observedAt: string;
  onContinue: () => void;
}) {
  return (
    <section className="surface surface--newsroom" data-surface="crisis-newsroom" aria-labelledby="news-title">
      <div className="newsroom-paper-wrap" aria-hidden="true">
        <Image src={incidentPaper} alt="" fill sizes="62vw" />
      </div>
      <div className="newsroom-editorial">
        <header>
          <span className="eyebrow">CUE 03 · REDAÇÃO DE CRISE</span>
          <span className="interface-label">INTERFACE ATIVA · NEWSROOM</span>
        </header>
        <p className="newsroom-date">EDIÇÃO DE {scenario.date.toUpperCase()}</p>
        <h2 id="news-title">{scenario.headline}</h2>
        <p className="newsroom-deck">{scenario.historicalImpact}</p>
        <a className="source-link" href={scenario.sourceUrl} target="_blank" rel="noreferrer">
          <Newspaper aria-hidden="true" />
          {scenario.sourceLabel}
          <ExternalLink aria-hidden="true" />
        </a>
      </div>

      <div className="truth-columns">
        <article>
          <TruthTag kind="FACT" />
          <strong>{scenario.shortName} · {scenario.year}</strong>
          <p>O que ocorreu está ancorado na fonte acima. O cenário está encerrado no arquivo.</p>
        </article>
        <article>
          {liveStatus === 'ready' ? <TruthTag kind="LIVE" /> : <TruthTag kind="UNKNOWN" />}
          <strong>
            {liveStatus === 'loading'
              ? 'Consultando NASA EONET…'
              : liveStatus === 'unavailable' || liveCount === null
                ? 'Consulta NASA indisponível'
                : `${liveCount} eventos naturais abertos`}
          </strong>
          <p>
            {liveStatus === 'loading'
              ? 'O contexto atual ainda não foi classificado.'
              : liveStatus === 'unavailable' || liveCount === null
                ? 'A simulação continua sem fingir que o contexto é live.'
                : `EONET · últimos 20 dias · observado ${observedAt}. Contexto global, não causal.`}
          </p>
        </article>
        <article>
          <TruthTag kind="SIMULATION" />
          <strong>{scenario.recommendation}</strong>
          <p>Estimativas operacionais serão submetidas à decisão humana.</p>
        </article>
      </div>

      <button className="primary-action primary-action--rose" type="button" onClick={onContinue}>
        ABRIR SALA DE DECISÃO <ArrowRight aria-hidden="true" />
      </button>
    </section>
  );
}

function DecisionSurface({
  scenario,
  selected,
  onSelect,
  onApprove,
}: {
  scenario: Scenario;
  selected: 'reroute' | 'hold';
  onSelect: (value: 'reroute' | 'hold') => void;
  onApprove: () => void;
}) {
  return (
    <section className="surface surface--decision" data-surface="recovery-decision" aria-labelledby="decision-title">
      <header className="decision-header">
        <div><span className="eyebrow">CUE 04 · DECISÃO HUMANA</span><h2 id="decision-title">Dois futuros. Um pedido.</h2></div>
        <span className="interface-label">INTERFACE ATIVA · CONTROL ROOM</span>
      </header>

      <div className="decision-grid" aria-label="Escolha operacional">
        <button
          className={`option-card${selected === 'hold' ? ' is-selected' : ''}`}
          type="button"
          aria-pressed={selected === 'hold'}
          onClick={() => onSelect('hold')}
        >
          <span className="option-card__number">A</span>
          <span className="option-card__mode">MANTER PLANO</span>
          <TruthTag kind="SIMULATION" />
          <strong>Aguardar sinal operacional</strong>
          <p>Menor custo imediato, promessa exposta e fonte de tracking degradada.</p>
          <dl><div><dt>ETA</dt><dd>incerto</dd></div><div><dt>CUSTO</dt><dd>reserva</dd></div></dl>
          <span className="option-card__check"><Check /></span>
        </button>
        <button
          className={`option-card option-card--recommended${selected === 'reroute' ? ' is-selected' : ''}`}
          type="button"
          aria-pressed={selected === 'reroute'}
          onClick={() => onSelect('reroute')}
        >
          <span className="option-card__number">B</span>
          <span className="option-card__mode">RECOMENDAÇÃO ROUTESHIFT</span>
          <TruthTag kind="SIMULATION" />
          <strong>{scenario.routeAfter.join(' → ')}</strong>
          <p>{scenario.recommendation}</p>
          <dl><div><dt>ETA</dt><dd>{scenario.etaDelta}</dd></div><div><dt>CUSTO</dt><dd>{scenario.costDelta}</dd></div></dl>
          <span className="option-card__check"><Check /></span>
        </button>
      </div>

      <div className="sponsor-ops">
        <div><Sparkles /><TruthTag kind="MOCK" /><span>NAUTA</span><strong>risco, ETA e alternativas calculados</strong></div>
        <div><CircleDollarSign /><TruthTag kind="MOCK" /><span>YUNO</span><strong>estorno + nova autorização preparados</strong></div>
      </div>

      <div className="approval-bar">
        <div><ShieldCheck /><span>APROVAÇÃO NECESSÁRIA</span><strong>muda promessa, documento e exposição financeira</strong></div>
        <button className="primary-action" type="button" onClick={onApprove}>
          {selected === 'reroute' ? 'AUTORIZAR NOVA ROTA' : 'MANTER PLANO E MONITORAR'} <ArrowRight />
        </button>
      </div>
    </section>
  );
}

function ReroutedSurface({
  scenario,
  decision,
  destination,
  product,
  onContinue,
}: {
  scenario: Scenario;
  decision: 'reroute' | 'hold';
  destination: string;
  product: string;
  onContinue: () => void;
}) {
  const isHold = decision === 'hold';
  const activeMode = isHold ? scenario.modeBefore : scenario.modeAfter;
  const isAir = activeMode === 'AIR';
  const provider = isHold
    ? 'CONTINUITY WATCH'
    : isAir
      ? 'SKYBRIDGE EXPRESS'
      : activeMode === 'OCEAN'
        ? 'BLUEWATER CONTROL'
        : 'FLEXLINE MULTIMODAL';
  const route = routeWithDestination(isHold ? scenario.routeBefore : scenario.routeAfter, destination);

  return (
    <section
      className={`surface surface--recovery surface--recovery-${isAir ? 'air' : 'freight'}${isHold ? ' surface--recovery-hold' : ''}`}
      data-surface={isHold ? 'continuity-watch' : 'alternate-recovery'}
      aria-labelledby="recovery-title"
    >
      <header className="recovery-header">
        <div className="provider-mark"><ModeGlyph mode={activeMode} /><span>{provider}</span></div>
        <span className="interface-label">INTERFACE ATIVA · {isHold ? 'MONITORAMENTO' : modeLabel[activeMode].toUpperCase()}</span>
      </header>

      <div className="recovery-hero">
        <span className="status-pill"><Check /> {isHold ? 'PLANO ORIGINAL MANTIDO' : 'NOVA ROTA CONFIRMADA'}</span>
        <div className="local-provenance"><TruthTag kind="SIMULATION" /><span>Resultado hipotético da decisão humana</span></div>
        <h2 id="recovery-title">{route.join('  →  ')}</h2>
        <p>{isHold ? `O pedido ${product} permanece no modal original sob vigilância.` : 'A interface antiga saiu do DOM. Este é o novo contrato operacional da entrega.'}</p>
      </div>

      <div className="recovery-board">
        <div className="recovery-path">
          {route.map((stop, index) => (
            <div key={stop} className={index === 0 ? 'is-complete' : index === 1 ? 'is-current' : ''}>
              <span>{index + 1}</span><strong>{stop}</strong><small>{index === 0 ? 'HANDOFF' : index === 1 ? 'EM CURSO' : 'PRÓXIMO'}</small>
            </div>
          ))}
        </div>
        <dl className="recovery-details">
          <div><dt>{isHold ? 'TRACKER SOB VIGILÂNCIA' : 'NOVO TRACKER'}</dt><dd>{isHold ? `${scenario.trackerBefore} · sinal degradado` : scenario.trackerAfter}</dd></div>
          <div><dt>DOCUMENTOS</dt><dd>{isHold ? 'Preservar emissão original; sem troca de contrato' : scenario.documentChange}</dd></div>
          <div><dt>AJUSTE ETA</dt><dd>{isHold ? 'Incerto · reavaliar continuamente' : scenario.etaDelta}</dd></div>
          <div><dt>{isHold ? 'RESERVA' : 'AJUSTE AUTORIZADO'}</dt><dd>{isHold ? 'Sem novo débito; exposição monitorada' : scenario.costDelta}</dd></div>
        </dl>
      </div>

      <div className="audit-strip">
        <span><RefreshCw /> {isHold ? 'autorização original preservada' : 'autorização original cancelada'} <TruthTag kind="MOCK" /></span>
        <span><FileCheck2 /> {isHold ? 'documentos mantidos' : 'nova trilha documental criada'} <TruthTag kind="MOCK" /></span>
        <span><Satellite /> {isHold ? 'alerta de tracking reforçado' : 'fonte de tracking substituída'} <TruthTag kind="MOCK" /></span>
      </div>

      <button className="primary-action primary-action--green" type="button" onClick={onContinue}>
        ACOMPANHAR ÚLTIMA MILHA <ArrowRight />
      </button>
    </section>
  );
}

function LastMileSurface({
  destination,
  product,
  onContinue,
}: {
  destination: string;
  product: string;
  onContinue: () => void;
}) {
  return (
    <section className="surface surface--lastmile" data-surface="last-mile" aria-labelledby="lastmile-title">
      <header className="lastmile-header">
        <div className="lastmile-brand"><Truck /><strong>RÁPIDO LOCAL</strong></div>
        <span className="interface-label">INTERFACE ATIVA · ÚLTIMA MILHA</span>
      </header>
      <div className="lastmile-main">
        <div>
          <div className="local-provenance local-provenance--light"><TruthTag kind="SIMULATION" /><span>Motorista, horários e paradas demonstrativos</span></div>
          <span className="eyebrow">CUE 06 · CHEGADA LOCAL</span>
          <h2 id="lastmile-title">Agora é uma entrega de rua.</h2>
          <p>{product} entrou na janela local; o mapa global cede espaço à sequência de paradas.</p>
          <div className="driver-card"><span className="driver-avatar">ML</span><div><small>MOTORISTA</small><strong>Marina Lopes</strong><span>Veículo elétrico · RS-204</span></div><span className="driver-rating">4,96 ★</span></div>
        </div>
        <div className="stop-sequence">
          <div className="is-complete"><span>1</span><strong>Hub {destination}</strong><small>TRANSFERIDO · 14:08</small></div>
          <div className="is-current"><span>2</span><strong>Em rota</strong><small>3 PARADAS · 18 MIN</small></div>
          <div><span>3</span><strong>Destino final</strong><small>JANELA 14:30–15:00</small></div>
        </div>
      </div>
      <button className="primary-action primary-action--local" type="button" onClick={onContinue}>
        CONFIRMAR ENTREGA <PackageCheck />
      </button>
    </section>
  );
}

function DeliveredSurface({
  scenario,
  destination,
  product,
  decision,
  onRestart,
}: {
  scenario: Scenario;
  destination: string;
  product: string;
  decision: 'reroute' | 'hold';
  onRestart: () => void;
}) {
  const route = routeWithDestination(decision === 'reroute' ? scenario.routeAfter : scenario.routeBefore, destination);
  return (
    <section className="surface surface--delivered" data-surface="delivery-receipt" aria-labelledby="delivered-title">
      <div className="delivery-orbit"><Check /></div>
      <TruthTag kind="SIMULATION" />
      <span className="eyebrow">CUE 07 · DAY</span>
      <h2 id="delivered-title">Entregue. Com a história inteira.</h2>
      <p>{product}: {scenario.origin} → {destination}, apesar de {scenario.shortName}.</p>
      <div className="receipt-grid">
        <div><small>ROTA EXECUTADA</small><strong>{route.join(' → ')}</strong></div>
        <div><small>DECISÃO</small><strong>{decision === 'reroute' ? 'Rerota simulada e aprovada' : 'Plano original mantido'}</strong></div>
        <div><small>RECONCILIAÇÃO</small><strong>Concluída em mock</strong></div>
        <div><small>EVIDÊNCIA</small><a href={scenario.sourceUrl} target="_blank" rel="noreferrer">Abrir fonte histórica <ExternalLink /></a></div>
      </div>
      <button className="secondary-action" type="button" onClick={onRestart}><RefreshCw /> RODAR OUTRO CENÁRIO</button>
    </section>
  );
}

function CueRail({
  stage,
  maxReached,
  decision,
  onStage,
  onRestart,
}: {
  stage: Stage;
  maxReached: number;
  decision: 'reroute' | 'hold';
  onStage: (stage: Stage) => void;
  onRestart: () => void;
}) {
  const activeIndex = stages.findIndex((item) => item.id === stage);
  const activeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [stage]);

  return (
    <nav className="cue-rail" aria-label="Etapas da simulação">
      <div className="cue-play" aria-label="Avanço manual"><Pause /></div>
      <div className="cue-track">
        <span className="cue-progress" style={{ width: `${(activeIndex / (stages.length - 1)) * 100}%` }} />
        {stages.map((item, index) => (
          <button
            key={item.id}
            ref={item.id === stage ? activeButtonRef : undefined}
            className={`${item.id === stage ? 'is-active' : ''}${index < activeIndex ? ' is-complete' : ''}`}
            type="button"
            disabled={index > maxReached}
            onClick={() => onStage(item.id)}
            aria-current={item.id === stage ? 'step' : undefined}
          >
            <span>{index < activeIndex ? <Check /> : index + 1}</span>
            <small>{item.id === 'rerouted' && decision === 'hold' ? 'Plano mantido' : item.label}</small>
          </button>
        ))}
      </div>
      <button className="cue-reset" type="button" onClick={onRestart}><RefreshCw /> REINICIAR</button>
    </nav>
  );
}

export default function Home() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const [scenario, setScenario] = useState(scenarios[0]);
  const [stage, setStage] = useState<Stage>('order');
  const [maxReached, setMaxReached] = useState(0);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [product, setProduct] = useState(scenarios[0].product);
  const [promise, setPromise] = useState(scenarios[0].promise);
  const [destinationCoordinates, setDestinationCoordinates] = useState<[number, number]>(scenarios[0].destinationCoordinates);
  const [destinationLabel, setDestinationLabel] = useState(scenarios[0].destination);
  const [picking, setPicking] = useState(false);
  const [decision, setDecision] = useState<'reroute' | 'hold'>('reroute');
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('loading');
  const [observedAt, setObservedAt] = useState('agora');
  const [announcement, setAnnouncement] = useState('RouteShift pronto para uma nova entrega.');

  const stageIndex = stages.findIndex((item) => item.id === stage);
  const rerouted = decision === 'reroute' && stageIndex >= stages.findIndex((item) => item.id === 'rerouted');
  const basePrice = scenario.modeBefore === 'AIR' ? 4800 : scenario.modeBefore === 'OCEAN' ? 6800 : 7200;
  const price = basePrice + (product.includes('Fármacos') ? 1400 : product.includes('AOG') ? 900 : 0);

  const sceneTitle = useMemo(() => {
    const current = stages.find((item) => item.id === stage);
    const label = stage === 'rerouted' && decision === 'hold' ? 'Plano mantido' : current?.label;
    return `${label ?? 'RouteShift'} · ${scenario.shortName}`;
  }, [decision, scenario, stage]);

  useEffect(() => {
    document.title = `${sceneTitle} — RouteShift`;
  }, [sceneTitle]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const heading = surfaceRef.current?.querySelector<HTMLElement>('h1, h2');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [scenario.id, stage]);

  function advance(next: Stage, message: string) {
    const nextIndex = stages.findIndex((item) => item.id === next);
    setStage(next);
    setMaxReached((current) => Math.max(current, nextIndex));
    setAnnouncement(message);
  }

  function chooseScenario(next: Scenario) {
    setScenario(next);
    setStage('order');
    setMaxReached(0);
    setDecision('reroute');
    setProduct(next.product);
    setPromise(next.promise);
    setDestinationCoordinates(next.destinationCoordinates);
    setDestinationLabel(next.destination);
    setPicking(false);
    setArchiveOpen(false);
    setAnnouncement(`${next.shortName} selecionado para a simulação.`);
  }

  function restart() {
    setStage('order');
    setMaxReached(0);
    setDecision('reroute');
    setPicking(false);
    setProduct(scenario.product);
    setPromise(scenario.promise);
    setDestinationCoordinates(scenario.destinationCoordinates);
    setDestinationLabel(scenario.destination);
    setAnnouncement('Simulação reiniciada. Configure uma nova entrega.');
  }

  function renderSurface() {
    if (stage === 'order') {
      return (
        <MarketplaceSurface
          scenario={scenario}
          product={product}
          promise={promise}
          price={price}
          destinationLabel={destinationLabel}
          destinationCoordinates={destinationCoordinates}
          picking={picking}
          onProduct={setProduct}
          onPromise={setPromise}
          onPickToggle={() => setPicking((current) => !current)}
          onCoordinates={(coordinates) => {
            setDestinationCoordinates(coordinates);
            setDestinationLabel(`${coordinates[1].toFixed(2)}°, ${coordinates[0].toFixed(2)}°`);
            setAnnouncement('Destino atualizado por coordenadas acessíveis por teclado.');
          }}
          onArchive={() => setArchiveOpen(true)}
          onCreate={() => advance('transit', 'Entrega comprada. Interface de rastreamento modal ativada.')}
        />
      );
    }
    if (stage === 'transit') return <TransitSurface scenario={scenario} product={product} promise={promise} destination={destinationLabel} onTrigger={() => advance('incident', 'Disrupção detectada. A newsroom substituiu o rastreador.')} />;
    if (stage === 'incident') return <NewsroomSurface scenario={scenario} liveCount={liveCount} liveStatus={liveStatus} observedAt={observedAt} onContinue={() => advance('decision', 'Duas alternativas preparadas. Aguardando decisão humana.')} />;
    if (stage === 'decision') return <DecisionSurface scenario={scenario} selected={decision} onSelect={setDecision} onApprove={() => advance('rerouted', decision === 'reroute' ? 'Nova rota autorizada. Tracker e documentos substituídos.' : 'Plano original mantido. Monitoramento reforçado.')} />;
    if (stage === 'rerouted') return <ReroutedSurface scenario={scenario} decision={decision} destination={destinationLabel} product={product} onContinue={() => advance('lastmile', 'Handoff concluído. Interface de última milha ativada.')} />;
    if (stage === 'lastmile') return <LastMileSurface destination={destinationLabel} product={product} onContinue={() => advance('delivered', 'Entrega confirmada e trilha reconciliada.')} />;
    return <DeliveredSurface scenario={scenario} destination={destinationLabel} product={product} decision={decision} onRestart={restart} />;
  }

  return (
    <main className={`route-site scene-${stage}`} style={{ '--scenario-accent': scenario.accent } as React.CSSProperties}>
      <div className="stage-environment" aria-hidden="true">
        <Image src={stageEnvironment} alt="" fill priority sizes="100vw" />
        <Image className="stage-instrument" src={airInstrumentGhost} alt="" width={536} height={802} />
      </div>

      <header className="site-header">
        <Brand />
        <div className="stage-readout">
          <span className="stage-readout__dot" />
          <span>{sceneTitle}</span>
        </div>
        <button className="archive-nav" type="button" onClick={() => setArchiveOpen(true)}>
          <Newspaper /> ARQUIVO · 10 CASOS
        </button>
      </header>

      <div className="earth-stage">
        <LiveEarth
          scenario={scenario}
          rerouted={rerouted}
          picking={picking}
          destinationCoordinates={destinationCoordinates}
          destinationLabel={destinationLabel}
          onPick={(coordinates) => {
            setDestinationCoordinates(coordinates);
            setDestinationLabel(`${coordinates[1].toFixed(2)}°, ${coordinates[0].toFixed(2)}°`);
            setPicking(false);
            setAnnouncement('Novo destino marcado diretamente no globo.');
          }}
          onLiveContext={(count) => {
            setLiveCount(count);
            setLiveStatus(count === null ? 'unavailable' : 'ready');
            setObservedAt(new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date()));
          }}
        />
      </div>

      <div ref={surfaceRef} id="operating-surface" className="operating-surface" key={`${stage}-${scenario.id}`}>
        {renderSurface()}
      </div>

      <aside className="truth-legend" aria-label="Legenda de proveniência">
        <TruthTag kind="FACT" />
        <TruthTag kind="LIVE" />
        <TruthTag kind="SIMULATION" />
        <TruthTag kind="MOCK" />
      </aside>

      <CueRail
        stage={stage}
        maxReached={maxReached}
        decision={decision}
        onStage={(nextStage) => {
          setStage(nextStage);
          setAnnouncement(`${stages.find((item) => item.id === nextStage)?.label ?? 'Etapa'} aberta pela linha do tempo.`);
        }}
        onRestart={restart}
      />

      {archiveOpen && <ScenarioArchive selected={scenario} onSelect={chooseScenario} onClose={() => setArchiveOpen(false)} />}

      <p className="sr-only" aria-live="polite">{announcement}</p>
    </main>
  );
}
