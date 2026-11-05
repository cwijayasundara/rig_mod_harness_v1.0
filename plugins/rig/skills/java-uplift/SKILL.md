---
name: java-uplift
description: The RIG bridge for same-language Java uplift (Java 8/11/17 to 21, Spring Boot 2.x to 3.x, javax to jakarta, Hibernate 5 to 6, Thymeleaf 3.0 to 3.1) — the uplift contract, the deterministic recipes stage (OpenRewrite), the delta catalog of breaking changes with triggers and generators, and how to observe a web application. Load before planning, implementing, reviewing or building oracles for an uplift (U) unit on Java.
---

# Java uplift bridge

An uplift unit keeps the code and the architecture, and changes only versions: the language level, frameworks and
libraries. Its contract is the strictest in RIG (`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md` §2): **the observation
surface is preserved exactly**. A change a user or another system can see is not an uplift. It is a defect, or a
separate R step with a declared delta.

Read [references/deltas.md](references/deltas.md) before planning, implementing or writing generators.

## The stages, for an uplift unit

1. **Delta catalog first.** The `version-delta-analyst` agent writes `analysis/<system>/DELTA_CATALOG.md`. It lists
   each breaking change in `references/deltas.md` that **this code actually hits**, with the `path:line` sites and the
   generator that reaches it. A change the code does not hit is listed as not applicable, with the sweep that shows it.
   Each hit becomes a `hazard:<delta-id>` input class.
2. **Recipes (deterministic).** Run OpenRewrite before any agent edits code, with the recipe for the target, on a
   clean checkout of `target_scope`. For example, Spring Boot 2.7 to 3.x:
   ```
   ./mvnw -B -U org.openrewrite.maven:rewrite-maven-plugin:run \
     -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-spring:RELEASE \
     -Drewrite.activeRecipes=org.openrewrite.java.spring.boot3.UpgradeSpringBoot_3_0
   ```
   Log the recipe, its version and the files it changed. The worker handles only what the recipe left, and the
   reviewers see both the recipe diff and the worker diff, labelled.
3. **The worker** fixes what fails to build or test, and every catalog hit the recipe did not settle. Keep behaviour,
   never add features, and never upgrade anything the target does not require. Upgrades that change visible output
   (a webjar version in a URL, a new default page) need a pinned version or a setting that keeps the old behaviour.
4. **Both sides run.** The source side runs on its own runtime (for Java 8 code, a Java 8 JVM). If it can only run on a
   newer JVM, that is a difference from production, recorded in `PREFLIGHT.md` check 4.

## Observing a web application

- **Gate unit:** one route, `http:<METHOD> <path pattern>` (for example `http:POST /owners/{ownerId}/edit`). One work
  unit can cover all routes of one deployable (`gate_units: [...]`). Each route still gets its own surface.
- **Inputs (canonical case):**
  - `records.requests`: the ordered HTTP requests of a scenario (method, path, query, form fields, headers that
    matter), with session cookies carried between them
  - `stores`: the seed database by content hash (the `schema.sql` and `data.sql` in effect, plus prior requests)
  - `clock`: the server time, when dates are shown or validated
  - `params`: the active profile and properties
- **Observations:**
  - `screens`: one entry per request, `{status, headers: {content-type, location}, body}`. The body is the HTML or
    JSON exactly as served.
  - `stores`: the rows of each table the scenario writes, read after the scenario, ordered by primary key, with
    `record_order` meaning the order the application lists them in, not the storage order.
  - `messages`: validation and error messages a user sees, extracted from the page.
- **Runner:** `${CLAUDE_PLUGIN_ROOT}/scripts/rig_http.ts`, the same command on both sides (`references/proof.md` in
  `rig-method`, "HTTP runner"). Surface ids are `GET /owners.screen`, `GET /owners/owners.field:telephone`, with
  scenarios as labels, never in the id.
- **Normalizers** are rarely legal here (§6.2): a browser user is a consumer whose list is never complete. Values that
  must vary (a CSRF token, a session id, a generated timestamp) are masked only with a normalizer a person approves,
  after `rig_proof.ts normalizer` says it is legal.
