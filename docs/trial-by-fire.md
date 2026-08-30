# Trial by Fire — Bill of Lading Validation

## Judge mutation

“Validate Bill of Lading against booking before confirming.”

The server must remain running. Only validated flow data changes.

Start the app in one terminal with `pnpm dev -- --port 4388`. In a second terminal run `pnpm verify:trial`. The script connects from SSE sequence zero, proves the initial document-preparation order, mutates the running server twice with different random IDs, completes the same-run human correction, and repeats the condition with AIR.

## Fixture

- Run: `RS-NW26-014`
- Scenario: `EVT-014`
- Mode: `OCEAN_ROAD`
- Booking: `BKG-NW26-014`
- Container: `MSCU0142026`
- Booking POD: `TRISK`
- Bill of Lading: `MAEU-NW26-014`
- B/L POD: `TRMER`
- Booking weight: `18,240 kg`
- B/L weight: `19,050 kg`

Expected result: two blocking differences, an `810 kg` or `4.44%` weight delta, `98%` confidence, and recommendation `request-corrected-document`.

## Pass conditions

1. A random step ID is inserted after `prepare-booking` and before `confirm-booking`.
2. The flow version and run revision increase.
3. The cue graph gains the step from flow data.
4. The compiler emits document summaries, field differences, confidence, provenance, and human actions from capabilities and output shape.
5. The run enters `awaiting_human`.
6. “Request corrected B/L” records a human action.
7. A mock corrected artifact is appended.
8. The same run resumes, revalidates, matches, and reaches booking confirmation.
9. Repeating the action with the same idempotency key creates no duplicate.
10. A stale revision returns HTTP 409.
11. A second random ID produces the same semantic UI without source edits.
12. AIR emits `step.skipped` and continues.

## Failure conditions

The trial fails if the implementation requires a step-specific React component, a renderer condition on the step ID/title, new CSS for the random ID, a rebuild, a server restart, or arbitrary generated code.
