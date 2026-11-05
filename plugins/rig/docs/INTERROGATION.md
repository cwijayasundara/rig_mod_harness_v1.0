# Interrogation of PROPOSAL.md v0.1

Run 2026-11-04. Three adversaries (Opus xhigh, the session model, Fable xhigh) each tried to break the design with Python prototypes of its own mechanisms. Java and GnuCOBOL are not installed, so COBOL semantics are modelled in Python: COMP-3, ROUNDED as half away from zero, PIC truncation, and cp037 EBCDIC collation.

The orchestrator reran every reported command. All 21 reported findings reproduced. They merge into nine root causes below.

Setup for every command:

```sh
PY=/Users/cwijayasundaragmail.com/Documents/learning_101/rig_mod_harness_v1.0/.venv/bin/python
S=/private/tmp/claude-501/-Users-cwijayasundaragmail-com-Documents-learning-101-rig-mod-harness-v1-0/34986fc5-f7aa-415b-a133-32a073933b89/scratchpad/interrogate
```

The scratchpad is session-scoped. Copy `$S` somewhere durable if you want to keep the repros.

## Intent

RIG must modernize any legacy stack, including restructuring into modules or services, and prove at every step that the new system behaves like the old one. The design claims this through one-axis-at-a-time steps, a Delta Register, a verification ladder with held-out oracles, technology-neutral Pack interfaces, and a script-computed verdict.

## Findings

### 1. Delta comparators hide undeclared differences
Found by all three adversaries.

A comparator that projects both outputs into `Statement{account, lines[], totals}` drops every field outside that model. A service that gets minimum payment and due date wrong still passes.

```
$PY -I $S/adv-1/p3_delta_comparator.py
comparator(legacy, buggy service)  : PASS | modern minimumPaymentDue=6.68 (legacy 25.00), paymentDueDate=2026-12-01 (legacy 2026-11-25)
1-byte changes to MINIMUM PAYMENT DUE: 5 of 5 undetected
```

This breaks the claim "undeclared differences are always failures". Also reproduced by `adv-2/f3_delta_projection.py` and `adv-3/p3_delta_comparator.py`.

**Design change.** A comparator must be total. Every legacy output field is mapped, or listed in a human-approved `ignored`/`removal` entry, and every modern field is accounted for. A per-field canary sweep proves it before the comparator is trusted.

### 2. The held-out oracle does not separate, and cheats pass it
Found by adversaries 1 and 2.

Splitting by a hash of the case ID puts duplicate inputs in both sets. The judge returns evidence that the retry loop feeds back to the worker. Small units get an empty held-out set. A lookup-table implementation passes everything, and mutation testing scores it higher than honest code.

```
$PY -I $S/adv-1/p1_heldout_leak.py
held-out cases whose exact input is also a dev case: 30/44
attempt 2: judge PASS held-out 44/44
memoriser on 4943 fresh accruing accounts: 0.5% correct
small units (3-12 cases) with an EMPTY held-out set: 38/300

$PY -I $S/adv-1/p2_mutation_antistub.py
honest   : ... score=85.7% ...
memoriser: ... score=100.0% ...
```

Also reproduced by `adv-2/f2_lookup_cheat.py` (17 of 19 held-out inputs also in dev).

**Design change.** Split by a hash of the canonicalised input, deduplicated, with a minimum held-out size per unit. The judge returns only pass/fail counts. A revealed held-out case moves to dev and is replaced. Generate fresh inputs at judge time. Treat mutation score as a measure of test strength, never as evidence against overfitting.

### 3. Normalizers erase behaviour that matters, and T gates are per program
Found by adversaries 2 and 3.

A "float tolerance" normalizer on a decimal field hides a COBOL `ROUNDED` versus `HALF_EVEN` bug. A "record order" normalizer hides an EBCDIC versus ASCII sort that breaks the next JCL step. Each program is PROVEN alone, but the job is wrong, and V8 end-state checks do not apply to T steps.

```
$PY -I $S/adv-2/f1_rounding.py
records actually different=2409
V3 verdict: PROVEN

$PY -I $S/adv-3/p2_record_order_normalizer.py
WU-T-STEP1  V3 normalizers=[record_order]  : PASS
INTJOB equivalent        : False
```

Also reproduced by `adv-2/f4_sort_collation.py`.

**Design change.** Ban tolerance on decimal types. Allow an order normalizer only when the knowledge graph shows that no downstream reader depends on order. Add job-level golden masters to the T gate. Gate normalizer changes like deltas (see finding 9).

### 4. Generators and rule coverage miss construct semantics
Found by adversary 3.

A worker drops the `status = ACTIVE` clause. It still passes the dev and held-out oracles, scores 88% on mutation, and V6 rule coverage passes, because no test varies that clause. Separately, `ROUNDED` ties occur 137 times per million balances in production, but boundary generators and 10,000 random property-based tests hit none.

```
$PY -I $S/adv-3/p4_mutation_rule_gate.py
V6 rule coverage BR-ACCT-017 -> ... PASS
production: CLOSED account, balance 5000.00 @ 24.99%  legacy: 0.00  modern: 3.42

$PY -I $S/adv-3/p7_rounding_tie.py
PBT  10000 random examples: 0 mismatches
exact ties among  1,000,000 balances @5.00% : 137
```

**Design change.** V6 requires, for each rule card, generated tests that negate each `given` conjunct. Generators in V4 must target constructs: ROUNDED ties, ON SIZE ERROR overflow, PIC truncation. Fix the sample card, because it says `round_half_even` and COBOL `ROUNDED` defaults to half away from zero.

### 5. A data step changes behaviour, and V7 cannot see it
Found by adversaries 1 and 3.

Moving VSAM to an RDBMS moves key collation into the store. Programs that browse with `START KEY >=` and `READ NEXT` get different rows. Counts, sums and hash sets match, so V7 passes, and the ladder runs no differential on X steps. This contradicts Rule 1. A data-platform change also changes behaviour.

```
$PY -I $S/adv-1/p4_xstep_collation.py
X-step applicable rungs ['V0', 'V1', 'V5', 'V7', 'V9'] -> PROVEN
browse page from 'M0000'  legacy: ['M5000', 'Z0001', '00077', '10023']  modern: ['M5000', 'Z0001']
```

Also reproduced by `adv-3/p1_xstep_collation.py`.

**Design change.** X steps also run V3 by rerunning programs against the migrated store. V7 adds key collation and ordering checks. Rule 1 should say that an X step must preserve the store's comparison semantics, or declare the change as a delta.

### 6. The Pack interfaces cannot run the modern side or load data
Found by all three adversaries.

`TargetPack` has no `run_unit`, `record_io` or `input_generators`, so V3 and V4 cannot feed inputs to modern code. U and R steps have target technology on both sides and no runner at all. `DataPack` has no load method. `canonicalize(record: bytes, layout)` cannot take a Postgres row, or a record whose REDEFINES view depends on an earlier header record.

```
$PY -I $S/adv-3/p6_pack_interface.py
V3 differential : AttributeError: 'Java21Spring3' object has no attribute 'run_unit'

$PY -I $S/adv-1/p5_canonicalize_context.py
CORRECT migration: V7 via §5 canonicalize(record, layout) -> FAIL
BUGGY migration  : V7 via §5 canonicalize(record, layout) -> PASS
```

Also reproduced by `adv-2/f5_pack_iface.py`.

**Design change.** Split Packs into capabilities any Pack can implement (Parse, Build, Run, Record, Generate), independent of source or target role. Add `load` to DataPack. Make canonicalisation a stream over typed records with context.

### 7. The verdict policy deadlocks when legacy cannot run
Found by adversaries 1 and 2.

For logs-only or nothing-recorded estates, V2 to V6 cap at PARTLY_PROVEN until V10. The T gate needs PROVEN, and V10 runs only on E steps, which come after T.

```
$PY -I $S/adv-1/p6_policy_deadlock.py
no-exec-logs-only  merged=[] V10_run=False -> STUCK before T
```

Also reproduced by `adv-2/f6_verdict_policy.py`.

**Design change.** Let a T step merge at PARTLY_PROVEN in a provisional state. The obligation to reach V10 travels with the module and blocks cutover until it is met.

### 8. The cutover window can finish without a month-end
Found by adversaries 1 and 2.

"10 consecutive business days" reaches PROVEN mid-month. A capitalisation bug that only appears at a 31-day month-end surfaces after cutover.

```
$PY -I $S/adv-1/p7_estep_window.py
2026-11-13 V10 streak=10 -> cutover policy PROVEN (no month-end in window)
2026-12-31 V10 MISMATCH legacy=3875000.00 modern=3750000.00 (month-end capitalisation)
```

Also reproduced by `adv-2/f6_verdict_policy.py`.

**Design change.** Define the window as required calendar events: month-end for each month length the code branches on, quarter-end, year-end, and leap day.

### 9. The evidence ledger key is incomplete
Found by adversaries 1 and 3.

The key `(module, rung, commit, oracle version)` omits normalizer and comparator config. Adding a tolerance and rerunning flips a FAIL to PROVEN under the same key. Keying on the module's last commit misses a shared `common/` change. Keying on repo HEAD invalidates good evidence after a doc edit.

```
$PY -I $S/adv-3/p5_ledger_verdict.py
same ledger key for run1 and run2: True
verdict (runs 1,2) policy=latest_wins   : PROVEN

$PY -I $S/adv-1/p8_stale_evidence.py
after common/ change  : (a) PROVEN | (b) NOT_PROVEN(stale evidence) | V3 re-run passes: False
after cards/ doc edit : (a) PROVEN | (b) NOT_PROVEN(stale evidence) | V3 re-run passes: True
```

**Design change.** Key evidence on a hash of the module's build-dependency closure, plus the oracle, normalizer, comparator, Pack and legacy-tree hashes. Make normalizer changes a human gate. Define explicit supersession rules for reruns and flaky failures.

## Dropped

No reported finding failed to reproduce, so none were dropped. Each adversary also listed ideas it did not prove with a run. They are not findings, but they are worth probing next:

- **Adversary 1 (5 unproven).** GnuCOBOL and z/OS differ on TRUNC, NUMPROC and S0C7. CICS SYNCPOINT split across services. Module-boundary comparison after R steps. REDEFINES write-through-one-view. Card rounding mode (confirmed by finding 4).
- **Adversary 2 (5 unproven).** Ledger missing comparator hash (confirmed by finding 9). Rule 1 versus Phase C module layout. Range split in the WU example. PIC overflow. Pseudo-conversational CICS state through a stateless `run_unit`.
- **Adversary 3 (4 unproven).** GnuCOBOL default collation. Anti-stub bypasses (`assumeTrue(false)`, logged catch). Contiguous held-out IDs in the WU example. Comparator authorship outside the oracle-creator rule.
