# Architecture Decision Log

## ADR-001 — Events are the execution record

**Decision:** Store append-only events and derive snapshots with a pure reducer.

**Reason:** Replay, auditability, same-run continuation, deterministic tests, and visible proof are more important than hidden mutable state.

## ADR-002 — Finite semantic UI registry

**Decision:** Agents emit bounded semantic intent; a compiler selects from an allowlisted registry.

**Reason:** Arbitrary generated code is unsafe, difficult to test, and unnecessary for the challenge. A finite registry still proves that new flow steps compose new interfaces at runtime.

## ADR-003 — SSE instead of WebSocket

**Decision:** Use Server-Sent Events for public run updates.

**Reason:** The product needs ordered server-to-client progress with straightforward replay and reconnection. Human actions remain ordinary validated POST requests.

## ADR-004 — Deterministic provider first

**Decision:** The judge path uses a deterministic provider; OpenAI is optional.

**Reason:** The demonstration must remain repeatable without credentials or network access while still showing the correct agent boundary.

### 2026-08-30 — Use external providers without making them demo dependencies

**Decision:** OpenAI, AISStream, ADSB.lol, NASA EONET, and Yuno Sandbox are optional server-side providers with strict schemas, bounded timeouts, visible provenance, and deterministic or unavailable fallbacks.

**Reason:** A live hackathon demonstration needs authentic external evidence, but it must never mislabel missing data, expose credentials, depend on network success, or fail the core same-run human loop.

### 2026-08-30 — Separate logistics pricing from Yuno

**Decision:** RouteShift calculates the illustrative freight quote. Yuno is responsible only for payment orchestration in Test Mode.

**Reason:** Yuno is not a freight-rating engine. Keeping the boundary honest produces a stronger sponsor integration and prevents a simulated tariff from being presented as a provider result.

## ADR-005 — D1 authority with an explicit local-memory fallback

**Decision:** Keep `InMemoryRunStore` as the deterministic execution engine, but make Sites-managed D1 authoritative for hosted run records. Scope every hosted run to an opaque HttpOnly session, serialize mutations with a short D1 lease, and deliver committed D1 events as finite SSE checkpoints that reconnect with `Last-Event-ID`. Local open-stream subscriptions remain available only to the explicit in-memory preview.

**Reason:** A stateless public Worker can route creation, snapshot, and SSE requests to different instances. D1 preserves the same run across those requests without making the local judge demo or deterministic tests depend on external infrastructure. Explicit Node previews remain visibly non-durable.

## ADR-006 — Historical events are evidence fixtures

**Decision:** `app/scenarios.ts` remains a disruption archive, not a workflow model.

**Reason:** Historical facts, live current context, simulated consequences, and connector mocks require different provenance and lifecycle rules.

## ADR-007 — Preserve the cyclorama

**Decision:** Keep the incumbent Earth-led cinematic world while replacing its state authority.

**Reason:** The current product already communicates modality change exceptionally well. The architectural weakness is underneath the surfaces, not the visual premise.
