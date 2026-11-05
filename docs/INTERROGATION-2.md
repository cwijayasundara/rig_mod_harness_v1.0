# Interrogation of PROPOSAL.md v0.2

Run 2026-11-05. This is the second round. The first round attacked v0.1. Its findings are in [INTERROGATION.md](INTERROGATION.md).

Three adversaries (Opus xhigh, the session model, Fable xhigh) built Python prototypes of the v0.2 mechanisms, following the cited lines of `PROPOSAL.md`. Java and GnuCOBOL are not installed, so COBOL semantics are modelled in Python.

The orchestrator reran every reported command. All 27 reported findings reproduced. They merge into 11 root causes. Four of them (2, 4, 6, and 10 below) are v0.1 defects that v0.2 fixed only in part.

```sh
PY=/Users/cwijayasundaragmail.com/Documents/learning_101/rig_mod_harness_v1.0/.venv/bin/python
S=/private/tmp/claude-501/-Users-cwijayasundaragmail-com-Documents-learning-101-rig-mod-harness-v1-0/34986fc5-f7aa-415b-a133-32a073933b89/scratchpad/interrogate2
```

The scratchpad is session-scoped. Copy `$S` somewhere durable to keep the repros.

## Intent

v0.2 claims that every proof mechanism is defined against a complete observation surface. It also claims to fix the nine v0.1 defects with these mechanisms: total comparators with canary sweeps, consumer-checked normalizers, content-addressed oracles with a counts-only judge, job-level gate units, a full evidence key, PROVISIONAL obligations, FLAKY handling, calendar-derived cutover windows, and capability-checked Packs.

## Two patterns behind most findings

**Unknown is treated as absent.** The design derives consumers, calendar events, and capabilities from static analysis and Pack declarations. When the analysis finds nothing, the design treats that as "nothing there". The analysis misses dynamic `CALL`s, external file readers, scheduler parameters, and runtime utilities. Root causes 1, 9, and 10 all follow from treating a gap in analysis as a fact.

**Evidence does not prove what it exercised.** A rung passes, or an obligation is discharged, because a run happened. Nothing checks that the run reached the risk it was supposed to cover. Root causes 4, 7, and 8 follow from this.

## Root causes

### 1. An empty consumer list counts as external, so erasing normalizers become legal
Found by all three adversaries.

§3 defines `consumers: []` as external. §6.2 allows an erasing normalizer when no consumer depends on what it erases. An empty list therefore passes the check, including for files that a bank, GL bureau, or print vendor reads, and for readers reached through `CALL WS-NEXT-PGM`.

```
$PY -I $S/adv-1/f2_normalizer_external.py
NORM-031 on INTJOB/STEP2/GLFEED.record_order     legal=(True, 'no consumer in graph')
V3 at gate unit job:INTJOB through NORM-031: PASS
GL bureau match-merge: legacy feed matched 6/6, modern feed matched 2/6
```

Also reproduced by `adv-2/f1_external_consumer_normalizer.py` (ACH file) and `adv-3/g_external_consumer_normalizer.py` (dynamic CALL and a print vendor). Adversary 1 also showed that the sample NORM-012 fails its own rule. It names `REPT01` as the consumer, while §3 gives `STEP2` for the same observable.

**Design change.** An empty list means unknown, and unknown forbids erasure. An external consumer is an explicit node with declared dependencies, attested by a human or an interface contract.

### 2. The gate-unit rule pulls in most of the system
Found by all three adversaries.

§6.4 defines the gate unit as the smallest unit whose surface has only external consumers. A shared master file has many internal readers, so the closure grows through it. For CBACT04C it reaches 12 of 18 CardDemo entry points. That contradicts the §5.1 example `gate_unit: job:INTJOB`. The first translated program could not merge until 12 entry points were translated. Treating stores as external instead brings back the v0.1 sort-order bug.

```
$PY -I $S/adv-1/f1_gate_unit.py
computed gate unit for CBACT04C: 12 of 18 entry points (7 batch jobs + 5 CICS transactions)
first T unit merges only if the modern gate unit runs: members translated 1/12 -> modern side runnable: False

$PY -I $S/adv-3/d_gate_unit.py
gate_unit(job:INTJOB   ) =  8 of 11 units -> WHOLE SYSTEM minus tx:CCUP,tx:CRPT,tx:CUSR
step 2 match-merge reads the file in order: equivalent = False
```

Also reproduced by `adv-2/f2_gate_unit.py`.

**Design change.** Make persistent stores gate boundaries. Compare what a job writes to a store, and how the store behaves, at the store itself. Use V7 store probes and V8 end state for this, not consumer closure. Order-dependent sequential files between steps stay inside the job.

### 3. Single-value canaries miss structural and representation bugs
Found by all three adversaries. This is v0.1 #1, fixed only in part.

The canary sweep changes one value per mapped observable. Comparators that zip arrays, compare columns, or parse numbers pass the sweep. They still miss dropped lines, duplicated lines, values swapped between records, flipped signs, lost leading zeros, and empty statements.

```
$PY -I $S/adv-1/f3_canary_sweep.py
canary sweep: 8/8 caught -> comparator ACCEPTED
buggy service, drops 2026-10-31 line (cycle-end uses < not <=) : PASS
buggy service, posts 2026-10-11 FUEL twice                     : PASS
buggy service, account sent as 12345 (leading zeros lost)      : PASS

$PY -I $S/adv-2/f3_canary_sweep.py
zip      canary sweep 11/11 -> TRUSTED | dropped last line=PASS ...
columns  canary sweep 11/11 -> TRUSTED | ... amounts swapped between lines=PASS ...
abs      canary sweep 11/11 -> TRUSTED | ... debit sign flipped=PASS
```

Also reproduced by `adv-3/a_canary_sweep.py`. It also showed that the sample DELTA-007 fails totality, because it does not map `STMTFILE.line.record_order`.

**Design change.** The canary set must include structural canaries (insert, delete, duplicate, reorder, swap across records) and representation canaries (sign, zero, null, padding, scale). Add `cardinality` as an observable kind. Fix DELTA-007.

### 4. Per-run seeds in the evidence key hide failures, and the 5-pass rule clears real bugs
Found by all three adversaries. This is v0.1 #9, fixed only in part.

The evidence key includes generator seeds, and each judge run draws a new seed. Two runs that disagree therefore get different keys, the older one counts as stale, and the newest run wins. FLAKY never fires. When FLAKY does fire, five consecutive passes clear it, so an intermittent bug passes after enough reruns.

```
$PY -I $S/adv-1/f4_flaky_key.py
policy A: deterministic defect on 1/4000 of inputs, code unchanged: PROVEN in 64.2% of 2000 units; FLAKY seen in 0
intermittent defect failing 25% of runs: FLAKY cleared to PROVEN in 2000/2000 units, median 11 reruns, max 80

$PY -I $S/adv-3/b_key_seed_flaky.py
same key for the two runs  : False
bug fails 15% of runs, rerun budget 10: PROVEN in  77.8% of units
```

Also reproduced by `adv-2/f6_flaky.py` (10% failure rate cleared in 99.3% of units).

**Design change.** Keep per-run seeds out of the evidence key. Key on the generator definition and keep every run under that key. A failing fresh input becomes a permanent case. A failure is cleared only by a code change that makes it pass, or by proof that the cause is infrastructure, which means reproducing the failure on the same input in a different environment. Reruns alone never clear a failure.

### 5. The evidence key misses runtime wiring and legacy job control
Found by adversary 2.

`dependency_closure` covers the module's build closure, and `legacy_tree` covers `source_scope`. A change to another step's Java class, to the Spring Batch job XML, or to the legacy JCL leaves the key unchanged, so earlier PASS evidence stays valid.

```
$PY -I $S/adv-2/f7_evidence_key.py
edit statements/StmtStep.java   key unchanged: True | V3 verdict: PASS  | modern job output and legacy reference both unchanged: False
edit batch/intjob.xml           key unchanged: True | V3 verdict: PASS  | ...
edit legacy/jcl/INTJOB.jcl      key unchanged: True | V3 verdict: PASS  | ...
```

**Design change.** Key gate-unit evidence on the gate unit's runtime closure: every step, the job wiring and configuration, and the legacy JCL, PROCs, and control cards.

### 6. When legacy cannot run, the oracle has no supply and the deadlock remains
Found by all three adversaries. This is v0.1 #7, fixed only in part.

Fresh and hazard inputs need legacy to compute their expected outputs. With recorded I/O only, the hazard generators cannot run, so V4 fails. The minimum sealed size cannot be topped up, and burned cases cannot be replaced. The unit never reaches PROVISIONAL, even though §6.5 promises it.

```
$PY -I $S/adv-2/f5_recorded_only_starve.py
CBACT04C (logs-only estate)      start: cannot start: sealed 6/20; no legacy Execute: cannot compute expected for generated input
CBACT04C (logs-only, big pool)   judge: V4 FAIL: required hazard generators ['rounded_ties', 'size_error'] not run ... best verdict: NOT_PROVEN (no path to merge)

$PY -I $S/adv-1/f8_sealed_burn.py
attempt 1: sealed 21 of 30; 9 burned to dev, replacements available 0/9; sealed 21 < min 30 -> next judge after 12 production nights
```

**Design change.** When legacy cannot execute, waive the sealed minimum and the hazard requirement explicitly. Turn each waived item into a named obligation (see root cause 8), and size the sealed set from what was recorded.

### 7. Revealing failed sealed cases lets a worker patch them and drains the sealed set
Found by adversaries 2 and 3.

§5.3 rule 2 moves a failing sealed case into the dev set so the worker can see it. A worker can then hard-code that input. The fresh generators do not draw from that input's equivalence class, so the patch passes. On a recorded pool, three attempts leaked 58 of 60 recorded inputs into dev, leaving a lookup table to pass "sealed 2 of 2".

```
$PY -I $S/adv-2/f4_patch_revealed_case.py
dev pass 1.0000 | fresh pass 1.0000 | generalisation (bound 0): PASS | lookup-shape lint: clean
production month: 392 of 200000 accounts get wrong interest

$PY -I $S/adv-3/c_burn_starve.py
after 3 attempts (budget attempts: 3, line 179): dev=58 sealed=2; 58 of 60 recorded inputs leaked into dev through rule 2.
judge output for attempt 2 (counts only, line 199): 'sealed 2 of 2' -> the lookup passes
```

The same script shows a second effect. Burning one case changes the oracle-set hash, which makes V0, V1, V5, and V9 evidence stale for no reason.

**Design change.** Never move sealed cases to dev. Report sealed failures as counts per generator or equivalence class, so the worker learns which behaviour is wrong but not the input. Generate new dev cases from the failing class. Key only V2 to V4 evidence on the oracle set.

### 8. Obligations can be discharged without exercising their risk, lost in a split, or impossible to discharge
Found by all three adversaries.

An obligation requires "V10 PROVEN on job:X". A V10 run with no invalid packed data discharges a NUMPROC obligation, and the S0C7 behaviour difference appears after cutover. When an R step splits a module, its obligations either vanish or point at a gate unit that no longer exists. A module kept in the monolith never gets an E step, so its V10 obligation can never be discharged.

```
$PY -I $S/adv-1/f5_obligation_discharge.py
records exercising the declared difference (invalid packed): 0
V10 on job:INTJOB: PROVEN -> OBL-INTCALC-PACKED discharged: True -> cutover blocked: False
after cutover, record 000000A721055C: z/OS legacy -> ('ABEND', 'S0C7 data exception')   modern -> ('RC=0', Decimal('73.40'))

$PY -I $S/adv-3/e_obligation_deadlock.py
cutover allowed             : False  (blocked for ever: the module that is never extracted never gets V10)
policy 1 (walk current modules): ... OBL-INTJOB-V10 LOST
policy 2 (walk all obligations): ... dischargeable = False -> cutover blocked for ever
```

Also reproduced by `adv-2/f10_obligation_discharge.py`.

**Design change.** An obligation names the observables and the hazard it covers. Only evidence that exercised that hazard on those observables can discharge it. Coverage counts come from the run, not from the rung's name. Any later gate unit that covers those observables can discharge it, through a parallel batch run, an LPAR run, or V10. R and E deltas must migrate obligations explicitly.

### 9. Calendar derivation misses scheduler-driven and weekday logic
Found by all three adversaries. This is v0.1 #8, fixed only in part.

The derivation looks for date arithmetic in code. It misses month-end runs that the scheduler selects through a JCL parameter (`PARM-CYCLE = 'ME'`). It also misses `ACCEPT ... FROM DAY-OF-WEEK`, where COBOL numbers Monday as 1 and Java's `Calendar` numbers Sunday as 1. With no triggers, the window requires no events, and V10 passes after one day.

```
$PY -I $S/adv-1/f6_calendar_parm.py
month-length triggers found in graph: [] -> required calendar events: {}
2026-11-09 run=DY parallel run match -> all required events seen -> V10 PROVEN, cutover allowed
2026-11-30 run=ME  legacy=5101.24  modern=5101.23

$PY -I $S/adv-3/f_calendar_dow.py
date-logic triggers found    : False  required events: {}
first divergence after cutover: 2026-11-13 (Friday): legacy posts=True modern posts=False
```

Also reproduced by `adv-2/f8_calendar.py`.

**Design change.** Keep a minimum window that does not depend on derivation: every weekday, one month-end of each length, and one quarter end. Derive extra events from code, scheduler calendars, JCL parameters, and control cards. Add day-of-week, century window, and cycle-date triggers to the hazard catalog.

### 10. The capability preflight trusts declarations that cannot run
Found by all three adversaries. This is a variant of v0.1 #6.

Preflight compares declared capabilities with each rung's needs. A COBOL Pack that declares `Execute` passes preflight, but GnuCOBOL cannot run CICS transactions, BMS maps, IDCAMS, DFSORT, or JCL, and `cobc` is not installed. The `java` Pack has no `Generate` capability, so the M4 exit check (PetClinic PROVEN) is unreachable as specified.

```
$PY -I $S/adv-1/f7_capability_preflight.py
txn:CAUP (COACTUPC)  preflight gaps=[] strongest reachable=PROVEN | V3 legacy side at run time: FAILS: GnuCOBOL cannot run ['bms_maps', 'cics_runtime']
job:TRANREPT         preflight gaps=[] strongest reachable=PROVEN | V3 legacy side at run time: FAILS: GnuCOBOL cannot run ['dfsort', 'idcams_repro', 'jcl']
U step java->java (M4): preflight gaps=[('V4', 'Generate')] strongest reachable=below PROVEN

$PY -I $S/adv-3/h_capability_preflight.py
preflight T/V3: PASS (no gaps)
V3 legacy Execute.run -> FileNotFoundError: cobc  (shutil.which=None)
```

Also reproduced by `adv-2/f9_capability.py`.

**Design change.** Declare capabilities per construct (CICS, BMS, IDCAMS, DFSORT, JCL) and per environment. Check them against the constructs in each gate unit. Prove each capability at preflight by running a smoke unit, and record `Execute.environment()` in `PREFLIGHT.md`. Give the `java` Pack a `Generate` capability.

### 11. The generalisation check rejects honest code and adds nothing
Found by adversary 3.

With the default bound of 0, an honest port that fails one bad dev recording but passes 5,000 of 5,000 fresh inputs fails the check. When dev is fully green, the check never changes a verdict that the fresh-input rung would not already give. The document's own example, "fresh 4,988 of 5,000, generalisation PASS", is impossible with a 44- or 100-case dev set.

```
$PY -I $S/adv-3/i_generalisation.py
honest port, dev 99/100 (one bad recording), fresh 5000/5000: FAIL  (rejected for being better on fresh than on dev)
example 'fresh 4,988 of 5,000, generalisation PASS' with a 44- or 100-case dev set: False
dev 100/100, fresh 4999/5000: generalisation FAIL | fresh rung alone: FAIL -> the check never changes a verdict once dev is green
```

**Design change.** Delete the generalisation check. The fresh-input rung already rejects memorised code. Treat a failure that appears only on dev as a suspected oracle defect for review.

## Dropped

No reported finding failed to reproduce. Each adversary also listed ideas it did not prove. These deserve a probe in the next round:

- **Adversary 1 (8 unproven).** `MULTIPLY ... GIVING ... ROUNDED` is missed by the ROUNDED trigger. Pack versions in every key invalidate all evidence after a porting-guide edit. A rule-card negation tests one falsifying value only. FILLER bytes and group MOVEs are missing from field-derived surfaces. Canary routing conflicts with obligations that block cutover. Content addressing merges recordings that differ only in hidden inputs. The generalisation example contradicts the bound (confirmed by root cause 11). Hazard inputs need legacy to run (confirmed by root cause 6).
- **Adversary 2 (5 unproven).** Content addressing ignores clock and CICS session state. A module kept in the monolith never gets V10 (confirmed by root cause 8). Nothing pins `BigDecimal` over `Math.round`. Burning can exhaust the sealed set even when legacy runs. A JDK patch in the environment fingerprint invalidates all evidence.
- **Adversary 3 (5 unproven).** The lookup-shape lint flags honest `EVALUATE` tables. The evidence key omits the graph and surfaces, so a newly found consumer never invalidates a normalizer. No capability provides the V10 routing facade or clock override. Near-duplicate recordings defeat deduplication. `dependency_closure` misses Flyway and `application.yml` collation settings.
