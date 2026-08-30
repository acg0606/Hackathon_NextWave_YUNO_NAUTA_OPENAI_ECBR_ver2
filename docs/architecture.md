# RouteShift Runtime Architecture

## Core invariant

The flow is the source of the experience. React does not decide which business step runs next. A validated flow, append-only events, and the materialized run state determine the active interface.

## Execution path

1. A strict `FlowDefinition` enters the flow engine.
2. The engine evaluates conditions and executes a registered semantic capability.
3. Each meaningful change is appended as a `RunEvent`.
4. The pure reducer folds events into a `RunSnapshot`.
5. The UI compiler maps step capabilities and validated outputs to a `RuntimeUISpec`.
6. The browser renders only allowlisted semantic sections.
7. A human action is validated against the active revision and resumes the same run.
8. SSE sends ordered public events and UI revisions to the browser.

## Runtime boundaries

- `lib/runtime/contracts.ts` defines the domain.
- `lib/runtime/schemas.ts` validates every external and agent-controlled value.
- `lib/runtime/reducer.ts` is the replayable source of materialized state.
- `lib/runtime/flow-engine.ts` executes generic flow semantics.
- `lib/runtime/run-store.ts` owns process-local runs, event subscriptions, idempotency, and serialized mutation.
- `lib/runtime/ui-compiler.ts` converts semantic state to a bounded UI specification.
- `components/runtime/component-registry.tsx` is the finite rendering authority.

The engine and compiler must never branch on a trial step ID or scenario ID. IDs establish identity; capabilities establish behavior.

## Predefined versus runtime-generated

Predefined in source are the strict schemas, registered tools, connector contracts, semantic capabilities, finite UI section registry, Muebles del Sur base flow, and deterministic evidence fixtures. Dynamically compiled at runtime are step placement, flow version, execution path, conditions, current ownership, section selection, focus, priority, truth context, and permitted actions. The agent may classify a natural-language instruction, compare bounded structured documents, report public findings, confidence, and a permitted recommendation. It cannot choose React components, markup, style, imports, executable code, or arbitrary URLs.

## State and concurrency

Each run has an immutable `runId`, monotonic event sequence, monotonic revision, flow version, event history, and materialized snapshot. Per-run mutation is serialized. Human actions include `expectedRevision` and `idempotencyKey`.

When a live flow insertion affects already executed downstream work, completed and skipped markers are invalidated, affected artifacts are removed, connector states and findings are marked stale, the prior agent summary is explicitly invalidated, and a reason is emitted before execution resumes. Purchased order fields are immutable in this prototype; a changed purchase creates a separate isolated run rather than silently rewriting operational history.

The included `InMemoryRunStore` is deliberately non-durable and single-process. The interface allows a future D1 or Durable Object adapter, but no production persistence is claimed.

## Agent boundary

The deterministic provider remains the factual authority for document comparison and is always available. When configured, OpenAI Structured Outputs classify natural-language flow changes and compose grounded public summaries from bounded evidence. Public metadata states whether a result came from OpenAI or the deterministic fallback. Neither provider may emit JSX, HTML, CSS, imports, URLs, executable code, or private chain-of-thought.

## External connector chain

- RouteShift owns the transparent simulated logistics quote; it is never attributed to Yuno.
- Yuno Sandbox owns test payment-link, lookup, capture, and cancel-or-refund operations. Production hosts are deliberately unsupported.
- AISStream supplies bounded current vessel observations through a server-only WebSocket.
- ADSB.lol supplies bounded current aircraft observations over server-side REST.
- NASA EONET supplies current hazard context with TTL, timeout, stale, and unavailable states.
- Nauta remains behind the replaceable connector interface because no public self-service API contract is claimed. Its operational behavior stays `MOCK_CONNECTOR` until sponsor sandbox access exists.

External observations enrich a run but do not silently change shipment truth. A vehicle-to-order association remains `SIMULATED_IF_TODAY` unless a real booking identifier independently proves it.

## Interface boundary

`RuntimeUISpec` communicates layout intent, priority, ownership, focus, truth context, semantic sections, and allowed actions. It never carries pixels or arbitrary component names. Unknown valid semantics render through `GenericStepSection`; invalid semantics are rejected.
