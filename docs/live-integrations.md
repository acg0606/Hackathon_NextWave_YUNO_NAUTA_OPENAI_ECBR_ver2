# Live and Sandbox Integrations

RouteShift runs without credentials, but it can replace several deterministic demo boundaries with validated external providers. All secrets remain server-only.

## OpenAI

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`. The server uses the Responses API with strict JSON Schema for semantic step inference and bounded public summaries. Deterministic document comparison remains authoritative. Any timeout, provider error, or invalid structured output activates `demo-agent-v1`; the UI shows which provider actually produced the public result.

## AISStream

Set `AISSTREAM_API_KEY`. The server opens `wss://stream.aisstream.io/v0/stream`, sends a small route-relevant bounding-box subscription immediately, validates bounded `PositionReport` and `ShipStaticData` frames, closes after the collection window, and emits only normalized observations.

The browser never receives the key or raw frames. A displayed vessel is “current traffic near the corridor,” not “your vessel,” unless a real MMSI or IMO from an independently verified booking is matched.

## ADSB.lol

No credential is currently required. For AIR runs the server requests a small radius around the current destination, validates and normalizes current aircraft positions, applies a short TTL, and preserves ODbL attribution. A displayed aircraft is not assigned to the simulated shipment.

## NASA EONET

No credential is required. Incident runs request current open-event context with a bounded response, strict schema, 2.5-second connector timeout, five-minute TTL, and explicit stale or unavailable state. Present-day EONET context does not validate a historical scenario.

## Yuno Sandbox

Set all of:

```text
YUNO_ENV=sandbox
YUNO_ACCOUNT_CODE=
YUNO_PUBLIC_API_KEY=
YUNO_PRIVATE_SECRET_KEY=
```

The Yuno account must also have its Test Mode checkout and testing gateway configured. When a buyer leaves “Use Yuno Sandbox when configured” selected and submits **Buy delivery**, RouteShift creates a one-time hosted Payment Link with delayed capture. The emitted result is `EXTERNAL_SANDBOX` and includes only public IDs, amount, status, environment, and the validated checkout URL.

The adapter also supports lookup, capture, and cancel-or-refund with `X-Idempotency-Key`, but the current UI does not invoke capture or reversal automatically. Production endpoints are intentionally unsupported.

## Nauta

Nauta has no public self-service developer contract that this repository can verify. RouteShift therefore keeps `mock-nauta.ts` explicit and replaceable. Current AIS and EONET observations may enrich the surrounding operational context, but Nauta milestones, ETA changes, and order correlation remain `MOCK_CONNECTOR` until the sponsor supplies sandbox URL, authentication, sample records, scopes, limits, and permission to display the data.

## Safe verification

Open **Integrations** in the product. It returns only configuration booleans, public modes, and observed connector state from the active run. A configured key is not treated as proof of a successful call; only validated run events change an integration to observed available.

Never paste `.env.local`, API keys, private headers, or raw provider payloads into an issue, screenshot, submission, or chat.
