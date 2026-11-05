# Restructure formats and hazards

## MODULES.json (`analysis/<system>/decomposition/MODULES.json`)

```json
{ "language": "java", "base_package": "carddemo", "adrs": ["ADR-0001"],
  "modules": {
    "app":      { "packages": ["carddemo"], "api": [], "depends_on": ["customer", "interest"] },
    "customer": { "packages": ["carddemo.customer"], "api": ["carddemo.customer"], "depends_on": ["shared"], "owns": ["CUSTFILE"] },
    "interest": { "packages": ["carddemo.interest"], "api": ["carddemo.interest"], "depends_on": ["shared"], "owns": ["ACCTFILE"] },
    "shared":   { "packages": ["carddemo.shared"], "api": ["carddemo.shared"], "depends_on": [] } },
  "stores": { "CUSTFILE": { "markers": ["DD_CUSTFILE"] }, "ACCTFILE": { "markers": ["DD_ACCTFILE"] } } }
```

A package belongs to the module that lists it or its longest listed prefix. `api` lists the packages other modules
may use; a module with an empty `api` is used by nobody. `markers` are strings that only code touching the store
contains (its DD or environment name, its table name, its repository class). Every store on a surface has exactly
one owner. `rig_arch.ts check` enforces all of it; its header lists the rules.

The options `/rig:design` writes (`option-business.json`, `option-data.json`) add `assign` (`{current file:
module}`, every source file once) and `rationale` (`{module: one line}`).

## ADR (`analysis/<system>/ADR-NNNN.md`)

```
# ADR-0001: <decision in one line>
Status: proposed
Date: <date>

## Context        what the graph shows: gate units, stores, the edges that matter (cited)
## Options        business seams; data seams; each with its scorecard numbers
## Decision       the modules, what each owns, the dependency direction; monolith or service and why
## Deltas         each visible change this decision requires, or "none"
## Consequences   what gets harder, the open questions for a person
```

A person signs in `/rig:review <system> adrs`. The signature is a line in `decomposition/signoffs.json` with the
sha256 of the ADR and of `MODULES.json` (from `rig_arch.ts hash`), so a later edit to either voids it. Only a person
writes that file; the guard denies subagents.

## Restructure hazards

Each one found in the code is a `hazard:<id>` input class whose generator reaches it.

| id | trigger | what can change on the surface |
|---|---|---|
| R-STATIC | mutable `static` fields, singletons, caches | moving code changes when state is shared or reset between jobs |
| R-INIT | static initialisers, class-load order | output or failure order changes when classes load in another order |
| R-NAME | `getClass().getName()`, `getSimpleName()`, stack traces, `toString()` defaults, resource paths | a package move changes text the system writes |
| R-ACCESS | package-private members used across what become module boundaries | widening access is fine; a copied helper that drifts is not |
| R-EXIT | `System.exit`, `Runtime.halt`, shutdown hooks | exit codes and the abend path move with the code |
| R-DUP | two copies of the same logic (encoders, file adapters) that a restructure would merge | merging copies that differ in one edge case changes output; merge only identical code, proved by the judge |
| R-REFLECT | `Class.forName`, service loaders, reflection on names | a moved class is not found at run time |
