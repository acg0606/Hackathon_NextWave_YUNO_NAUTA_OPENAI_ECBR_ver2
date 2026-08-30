# RouteShift Visual System

## World

RouteShift lives on an infinite theatrical cyclorama. A realistic Earth is the central actor; light, horizon, and shadow expose the operating state. The world progresses from depthless night through cobalt first light and rose dawn to white day. A crisis can interrupt the progression with an amber hold or blackout, but every state remains named and inspectable.

## Palette

- `cyc-black` — `#02050A`: the stage before a delivery exists and the background for severe interruptions.
- `horizon-cobalt` — `#173D91`: route, navigation, and active transport structure.
- `dawn-rose` — `#DF6F8C`: handoff, uncertainty, and transition.
- `day-white` — `#F5F4EE`: fulfilled promise, evidence paper, and daylight state.
- `cue-amber` — `#FFB000`: human action, warning, and the current cue.
- `signal-green` — `#66D3A3`: confirmed state, used sparingly and never as the only signal.

## Type and Composition

Cue names use compact stencil-like uppercase with tabular numerals. Human-facing copy uses a direct grotesk. The page composes in wide horizontal horizon bands, not cards. The Earth owns the visual field; controls attach to the horizon or emerge as stage marks. Content density may increase after an incident, but panels may not surround the globe or shrink it into a dashboard widget.

## Materials

Photorealistic orbital imagery, atmospheric light, haze, silhouette, shadow, calibration ticks, floor tape, and thin evidence sheets. The browser renders the Earth and routes semantically; no core control or label is baked into imagery.

## State Grammar

- `NIGHT / ORDER_DRAFT`: Earth at night; origin, destination, product, and promise are placed on the low horizon.
- `FIRST_LIGHT / QUOTE_READY`: route rises as a cobalt band and three delivery promises become selectable cues.
- `DAWN / IN_TRANSIT`: tracking surface is specific to ocean, air, rail/road, or local relay.
- `HOLD / DISRUPTION_DETECTED`: light stops, affected route breaks, amber incident cue enters, and the newsroom becomes visible.
- `CROSSFADE / AWAITING_HUMAN_DECISION`: original and alternate operating surfaces coexist briefly for comparison.
- `NEW_SCENE / REROUTED`: obsolete modal components leave the layout; the new modal interface enters.
- `DAY / DELIVERED`: promise, executed route, documents, mock payment adjustments, and sources reconcile in daylight.

## Motion

The signature interaction is a scrubbable cue timeline bound to interface state. Transitions raise, blend, hold, or black out the horizon while the component registry swaps the actual operating surface. Reduced motion uses discrete labeled cuts with the same information and focus order.

## Truth Treatment

Historical evidence uses `HISTORICAL_FACT`; current APIs use `LIVE_CURRENT_CONTEXT` or `UNKNOWN`; contrafactual outcomes use `SIMULATED_IF_TODAY`; sponsor and carrier actions use `MOCK_CONNECTOR`. Labels remain visible through every scene and are never communicated by color alone.

## Responsive Behavior

Desktop preserves the wide cyc and globe. Mobile shows one named lighting phase at a time, keeps the Earth above the fold, and advances through cues as discrete full-width scenes. The textual route summary is always available when WebGL is unavailable.
