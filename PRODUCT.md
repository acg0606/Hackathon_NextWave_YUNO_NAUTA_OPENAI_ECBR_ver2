# RouteShift
<!-- impeccable:product-schema 1 -->

## Platform

Web experience published through ChatGPT Sites.

## Stack

Vinext, React 19, TypeScript, Tailwind CSS, shadcn/ui, and Cloudflare Worker-compatible ESM. The user explicitly chose ChatGPT Sites as the delivery target.

## Users

- Primary: a NextWave hackathon juror acting as a buyer who places an international order and tests how its delivery would respond to a real historical disruption happening today.
- Secondary: the hackathon team or presenter demonstrating the scenario, inspecting evidence, and explaining operational decisions.

## Product Purpose

Let a person choose a product, origin, and destination; create a delivery; replay one of ten major historical logistics disruptions as if it happened today; enrich the replay with clearly labeled current context; and watch both the route and the interface rebuild around the new operating reality.

## Positioning

RouteShift is not a static logistics dashboard. Its interface is the product mechanism: it changes from shopping and order confirmation to transport-specific tracking, crisis newsroom, rerouting decision room, payment and document handling, and last-mile delivery according to what happens to the order.

## Operating Context

Product selection; origin and destination on a world map; delivery purchase; historical scenario selection; current-context retrieval; route tracking; incident playback; alternatives; human authorization; mock Yuno payment and Nauta operations; documents; evidence newsroom; carrier handoff; last mile.

## Capabilities and Constraints

- Ten curated historical scenarios, including the 2024 CrowdStrike/Delta disruption.
- A realistic, interactive Earth globe and visible global routes.
- A newsroom with real source links, historical dates, and observation dates.
- Historical facts, current context, and synthetic what-if outcomes must never be visually or semantically mixed.
- Yuno, Nauta, and carrier operations remain `MOCK_CONNECTOR` and create no external side effects.
- API keys remain server-side only.
- The first Sites version does not depend on AIS or OpenSky; live telemetry can be added after the core experience is proven.
- Do not clone DHL, Loggi, or another carrier. Build original, recognizably different interface languages for ocean, air express, and last mile.
- The experience must work with keyboard, touch, reduced motion, and a readable non-WebGL fallback.

## Brand Commitments

- Product: RouteShift by JAIGO.
- Core message: the interface rebuilds itself when reality changes.
- Every operational claim carries a truth label: `HISTORICAL_FACT`, `LIVE_CURRENT_CONTEXT`, `SIMULATED_IF_TODAY`, or `MOCK_CONNECTOR`.

## Evidence on Hand

- The existing research dataset contains seventeen historical events and thirty-one direct sources.
- Historical source URLs and observed dates are evidence; shipment paths, costs, ETAs, UI changes, and connector responses are simulations.
- No customer, accuracy, savings, or performance claim is approved without direct evidence.

## Product Principles

- Buy first, operate second: the juror should feel the consequence on an order they created.
- Historical facts stay dated; current context stays current; forecast outcomes stay explicitly simulated.
- Every disruption visibly changes both the route and the interface.
- A human authorizes rerouting and payment changes.
- Evidence remains inspectable without interrupting the story.
- The demo should make sense within five minutes without presenter narration.

## Accessibility & Inclusion

Support keyboard and touch route controls, legible scenario and evidence lists, clear contrast, reduced motion, screen-reader status announcements, and a textual route summary when WebGL is unavailable.
