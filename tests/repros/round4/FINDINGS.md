# Round 4: probes of the PROPOSAL §14 risks

2026-11-06, against commit `6098a67`. Each probe is a test in `tests/proof/round4/` that asserts the correct behaviour.
R4-02 and R4-03 failed when written and pass since the fixes; R4-01 passed when written and is kept as a pin.

| id | risk (§14) | finding | fix |
|---|---|---|---|
| R4-01 | REDEFINES write-through-one-view (M3) | Already handled by design: `cobol-to-java` maps REDEFINES to one byte area with typed views, and the `redefines` hazard has a generator. A port that keeps the views apart fails the hazard case; a run that never reaches it leaves a gap. | none (pin) |
| R4-02 | CICS SYNCPOINT split across services, shadow never exercises partial failure (M6) | No `syncpoint` hazard kind, and required hazards came only from the requirements file: a SYNCPOINT unit of work left out of it made V10 PROVEN and allowed cutover to primary on replayed traffic with no partial failure. | `verdict` requires every hazard of `hazards.json` whose site is in the gate unit's runtime closure; `syncpoint` added to the catalog (`artifacts.md`, `cobol-to-java/references/hazards.md`) with an injected-failure generator; `shadow.md` says to inject it. |
| R4-03 | Near-duplicate recordings that differ only in masked fields (M2) | Two recordings masked to the same input became one case id; when their legacy outputs differed the verdict said FLAKY, hiding a failure of a distinct production input; `case add` refused without saying why. | `shadow` records `input_collisions` (one input, two legacy outputs, elapsed time aside) and the verdict names them as an incomplete recorded input before any FLAKY; `case add` says why; `shadow.md` requires deterministic pseudonymization (equal values, equal tokens; different values, different tokens). |
