# Security Boundaries

## Inputs

Every flow, mutation, human action, runtime event, agent result, connector result, and UI specification is validated with a strict schema. Unknown keys and oversized structures are rejected.

## Code execution

The runtime never evaluates strings and never renders arbitrary HTML, CSS, JavaScript, imports, data URLs, or unregistered component names. The component registry is a source-controlled allowlist.

## Actions and tools

Tools, capabilities, connector operations, and human actions are allowlisted. An action must be present in the current UI specification and match the current revision. Duplicate idempotency keys cannot repeat effects.

## Concurrency

Mutations are serialized per run. Stale revisions return HTTP 409. Runs use separate event histories, snapshots, subscribers, and idempotency records.

## Secrets

`OPENAI_API_KEY`, `AISSTREAM_API_KEY`, and Yuno private credentials are read only in server code. They are never sent to the client, written to logs, stored in snapshots, or required for the deterministic demo. The integration-status API returns booleans and public modes only.

## Agent visibility

Public events contain concise summaries, evidence, confidence, selected action, and tool results. Hidden chain-of-thought is neither requested nor exposed.

## URLs

Only canonical HTTPS URLs on the finite source allowlist may be rendered. The Yuno Sandbox checkout host is explicitly allowlisted and validated before a link enters runtime state. Runtime specifications cannot introduce arbitrary URLs. Links use safe relation attributes.

## Persistence

Hosted runs are stored in Sites-managed D1 and every query includes an opaque `routeshift_session` identifier held in an HttpOnly, Secure, SameSite=Lax cookie. A visitor cannot list or fetch another session's runs by guessing a `runId`; scope mismatches return 404. Mutations acquire a bounded D1 lease and commit only against the expected revision. Hosted SSE replays and polls only committed D1 events, so reconnecting clients can recover missed sequences after a Worker changes without observing a mutation that later rolls back. Same-isolate subscriptions are limited to the explicit in-memory preview.

This is hackathon durability, not an account system. The cookie expires, there is no identity recovery or multi-device history, records are intentionally bounded, and explicit Node previews fall back to labeled process memory. R2 is not configured.

## External and mock side effects

Yuno is hard-coded to `api-sandbox.y.uno`; production hosts are not accepted. Creating a Payment Link requires an explicit buyer opt-in, server Test Mode credentials, strict input/output validation, timeout, and idempotency. Capture and cancel-or-refund adapter methods exist, but the current UI never invokes them automatically; any future wiring must require a validated human action. Nauta, carrier, document correction, ticket, and fallback payment behavior remain `MOCK_CONNECTOR`. Destructive-looking actions require confirmation.

AISStream opens only on the server, with a bounded geographic subscription and collection window. ADSB.lol and NASA responses have bounded payloads, timeouts, strict schemas, TTLs, and unavailable/stale states. Raw provider frames and credentials never enter the browser.
