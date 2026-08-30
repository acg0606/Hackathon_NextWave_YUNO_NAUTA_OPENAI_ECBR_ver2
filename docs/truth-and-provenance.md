# Truth and Provenance

RouteShift keeps evidence and generated operational consequences separate.

## HISTORICAL_FACT

A dated statement tied to a curated source. Historical fixtures include source title, URL, event date, publication date when known, retrieval date when known, confidence, and classification. Unknown metadata remains `UNKNOWN`; it is never invented.

## LIVE_CURRENT_CONTEXT

Current external context such as NASA EONET, AISStream vessel observations, or ADSB.lol aircraft observations. It includes fetch time, timezone, freshness, and failure state. Traffic near a corridor does not prove that a simulated order is aboard a specific vessel or aircraft, and present context does not validate a historical event.

## EXTERNAL_SANDBOX

A schema-validated result returned by an external provider's test environment. RouteShift currently uses this for Yuno Sandbox Payment Links and later payment operations. It proves an external sandbox interaction, but never a production charge, fund movement, settlement, or accounting effect.

## SIMULATED_IF_TODAY

Deterministic counterfactual output: route alternatives, ETA changes, costs, recommendations, confidence, and inferred operational consequences.

## MOCK_CONNECTOR

Local Nauta, carrier, document, ticket, notification, and payment fallback behavior. It demonstrates an operational contract without claiming an external side effect. Yuno is labeled `MOCK_CONNECTOR` only when its deterministic fallback is used; validated Yuno Test Mode results are `EXTERNAL_SANDBOX`.

## UNKNOWN

Unavailable, missing, or unverified information. Stale last-known external data keeps its original classification but is visibly marked stale; a missing response is `UNKNOWN` and never replaced by invented live data.

## Rendering rule

Truth is communicated with text and structure, never color alone. Local tags remain attached to relevant claims, and the persistent legend explains the canonical vocabulary.
