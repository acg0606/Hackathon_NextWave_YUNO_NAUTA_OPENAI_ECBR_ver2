# RouteShift — NextWave 2026 Individual Project

RouteShift is a flow-native logistics experience for the NextWave challenge “The Interface That Builds Itself.” A buyer creates an international delivery, applies a documented historical disruption as if it happened today, and watches the operational interface recompose around the active workflow, evidence, connector state, and human decisions.

## Repository boundary

This is the local individual edition of RouteShift. It is independent from the team repository `Hackathon-Nextwave-YUNO-NAUTA-OPENAI-ECBR`.

Do not use this checkout for team commits or pushes. Remote creation, publication, deployment, and Sites hosting require separate explicit authorization.

## What the runtime proves

- A strict `FlowDefinition` is the source of execution.
- Append-only `RunEvent` records reduce into a deterministic `RunSnapshot`.
- A semantic UI compiler produces a validated `RuntimeUISpec`.
- An allowlisted component registry renders interfaces without accepting JSX, HTML, CSS, or executable code from an agent.
- Server-Sent Events stream run changes to the browser.
- Human decisions pause and resume the same `runId`.
- Multiple runs remain isolated.
- A live flow mutation can insert “Validate Bill of Lading against booking before confirming” without rebuilding the application.

The deterministic demo provider requires no API key. When `OPENAI_API_KEY` is configured, the server uses strict OpenAI Structured Outputs for flow inference and grounded public summaries, exposes only safe provider metadata, and falls back deterministically on any failure. The judge path never depends on it.

This implementation is **Generative UI Level 4/5**: execution and composition change at runtime from validated semantic intent, including newly inserted steps, while rendering remains deliberately bounded by a finite component registry. Level 5 arbitrary code generation is intentionally rejected as a security boundary.

## Run locally

Requirements: Node.js 22.13 or newer and pnpm.

```powershell
$env:ROUTESHIFT_NODE_PREVIEW='1'
pnpm install
pnpm dev -- --port 4388
```

Open `http://localhost:4388/`.

### Optional real integrations

Copy `.env.example` to `.env.local` and add values locally. `.env.local` is ignored by Git and secret values must never be sent to the browser, logs, screenshots, or runtime events.

- `OPENAI_API_KEY` enables schema-validated semantic inference and public summaries.
- `AISSTREAM_API_KEY` enables bounded server-side vessel observations near the active corridor.
- `YUNO_ACCOUNT_CODE`, `YUNO_PUBLIC_API_KEY`, and `YUNO_PRIVATE_SECRET_KEY` enable a hosted Yuno Payment Link in Test Mode when the buyer explicitly leaves “Use Yuno Sandbox” selected.
- ADSB.lol aircraft observations and NASA EONET context use public current-data endpoints and require no credentials.

Yuno production hosts are intentionally unsupported. A sandbox result never affects production funds or accounting.

## Verification

```powershell
pnpm lint
pnpm exec tsc --noEmit --incremental false
pnpm test
pnpm build
```

With the local server still running in a second terminal:

```powershell
pnpm verify:trial
```

To create two local verification runs and print only sanitized connector status, IDs, timestamps, counts, and classifications:

```powershell
pnpm verify:live
```

## Five-minute demonstration

1. Start or select a Muebles del Sur run.
2. Inspect the flow graph, current owner, revision, public event feed, and generated operational surface.
3. Open the historical scenario archive and select a disruption.
4. Open **Integrations** and distinguish observed external calls, configured capabilities, deterministic fallbacks, and the Nauta mock.
5. Compare historical evidence, current NASA context, live AIS/ADS-B corridor traffic, simulated present-day consequences, and sponsor connector effects.
6. Insert the Bill of Lading validation step through the Flow Mutation Lab while the server remains running.
7. Observe the comparison interface appear from semantic capabilities, not a step-specific React branch.
8. Request a corrected B/L and verify that the same run resumes and reaches booking confirmation.
9. Repeat with another random step ID and with an AIR shipment, which safely emits `step.skipped`.

## Truth boundary

Every operational claim carries one canonical classification:

- `HISTORICAL_FACT` — dated evidence from a cited source.
- `LIVE_CURRENT_CONTEXT` — current external context with fetch time and freshness state.
- `EXTERNAL_SANDBOX` — a validated result returned by an external test environment, with no production effect.
- `SIMULATED_IF_TODAY` — a deterministic counterfactual outcome.
- `MOCK_CONNECTOR` — a local Nauta, carrier, document, or payment fallback with no external side effect.
- `UNKNOWN` — unavailable or unverified context.

NASA EONET, AISStream, and ADSB.lol provide current context; none proves that a simulated order is affected by an event or assigned to an observed vessel or aircraft. RouteShift pricing remains simulated. Yuno is used only for payment orchestration in Sandbox when explicitly enabled and configured. Nauta remains a labeled mock until sponsor sandbox documentation and credentials are available.

## Architecture map

- `lib/runtime/` — contracts, validation, event reduction, flow execution, run storage, semantic compilation.
- `lib/agent/` — deterministic and optional OpenAI semantic providers.
- `lib/connectors/` — Yuno Sandbox, AISStream, ADSB.lol, NASA EONET, and replaceable Nauta adapters.
- `lib/pricing/` — transparent simulated logistics pricing, kept separate from payment orchestration.
- `lib/flows/` and `lib/demo/` — workflow definitions and deterministic operation fixtures.
- `app/api/runs/` — run, action, flow mutation, and SSE endpoints.
- `components/runtime/` — streamed runtime shell, finite registry, semantic primitives, flow graph, event feed, and mutation lab.
- `app/LiveEarth.tsx` — realistic globe, route view model, current context, and accessible fallback.
- `app/scenarios.ts` — ten historical disruption fixtures and source provenance.
- `docs/` — architecture, security, truth, decision, and judge-demo evidence.

## Honest limitations

- The run store is process-local and non-durable. D1 and R2 are not configured.
- Nauta operations and shipment-to-vehicle correlation remain deterministic mocks until sponsor access is available.
- Yuno external behavior is Sandbox-only and requires Test Mode credentials plus checkout/routing configuration; production money movement is out of scope.
- AIS/ADS-B observations are current traffic context, not proof that the demo cargo is aboard a displayed vessel or aircraft.
- External context can be unavailable and is never required for the core demo.
- The finite semantic registry is intentionally bounded; it demonstrates safe runtime composition rather than arbitrary code generation.
- Purchased orders are immutable in this prototype. Changing product, destination, mode, or promise creates an independent run; same-run upstream order editing is reserved for a future revisioned input-mutation API.
