"""Regression tests for rig_proof.py: every interrogation root cause the proof core owns.

Each test names the root cause (INTERROGATION.md = round 1, INTERROGATION-2.md = round 2) and the
repro scripts under tests/repros/ whose attack it replays. Run:

    python3 -m unittest discover -s tests/proof -v

Root causes owned by commands rather than this script are listed at the bottom.
"""

import json
import shutil
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "plugins" / "rig" / "scripts"))
import rig_proof as P  # noqa: E402

UNIT = "INTJOB"
GU = "job:INTJOB"


def inp(records=None, clock="2026-11-09T02:00:00", params=None, stores=None):
    return {"records": records or {}, "params": params or {}, "clock": clock, "stores": stores or {}, "session": None}


def obs(rows, store="ACCTFILE", rc=0):
    return {"stores": {store: {"records": rows}}, "return_code": rc, "abend": None}


class Base(unittest.TestCase):
    def setUp(self):
        (ROOT / "tests" / "runs").mkdir(exist_ok=True)
        self.dir = Path(tempfile.mkdtemp(prefix="proof-test-", dir=ROOT / "tests" / "runs"))
        self.ws = P.WS(self.dir, "sys")
        (self.dir / "legacy").mkdir()
        (self.dir / "L").mkdir()
        (self.dir / "M").mkdir()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def case(self, n, classes=("random",), expected=None, **kw):
        return P.add_case(self.ws, inp(records={"IN": [{"n": str(n)}]}, **kw), list(classes), "random", expected)["id"]

    def pool(self, n, classes=("random",), **kw):
        return [self.case(i, classes, **kw) for i in range(n)]

    def observe(self, cid, legacy, modern):
        P.dump(self.dir / "L" / f"{cid}.json", legacy)
        P.dump(self.dir / "M" / f"{cid}.json", modern)

    def run_judge(self, set_name, key="K1", fresh=(), env="ref-a", comparator=None, normalizers=()):
        return P.judge(self.ws, set_name, key, self.dir / "L", self.dir / "M", list(fresh), comparator, list(normalizers), env)

    def surface(self, complete, internal=(), external=(), typ="decimal(9,2)", oid=f"{UNIT}/ACCTFILE.record_order"):
        s = {"gate_unit": GU, "observables": [{"id": oid, "kind": "record_order", "type": typ, "consumers": {
            "internal": list(internal), "external": list(external), "complete": complete}}]}
        P.dump(self.dir / "analysis/sys/surfaces/job-INTJOB.json", s)
        return "analysis/sys/surfaces/job-INTJOB.json"


# ---------------------------------------------------------------------------
# Round 2, root cause 1 (and round 1, root cause 3): normalizers erase what consumers need
# repros: round2/adv-1/f2_normalizer_external.py, adv-2/f1_external_consumer_normalizer.py,
#         adv-3/g_external_consumer_normalizer.py, round1 p5_canonicalize_context.py
# ---------------------------------------------------------------------------
class NormalizerConsumers(Base):
    def norm(self, surface, **kw):
        return {"id": "NORM-012", "observable": f"{UNIT}/ACCTFILE.record_order", "erases": "order",
                "surface": surface, "approved_by": "a person", **kw}

    def test_empty_consumer_list_is_unknown_and_forbids_erasure(self):
        errs = P.check_normalizer(self.ws, self.norm(self.surface(complete=False)))
        self.assertTrue(any("not complete" in e for e in errs), errs)

    def test_external_consumer_that_depends_on_order_forbids_erasure(self):
        s = self.surface(True, external=[{"name": "GL bureau", "depends_on": ["record_order"], "attested_by": "x"}])
        self.assertTrue(any("GL bureau" in e for e in P.check_normalizer(self.ws, self.norm(s))))

    def test_internal_consumer_without_cited_evidence_forbids_erasure(self):
        s = self.surface(True, internal=["program:REPT01"])
        self.assertTrue(any("REPT01" in e for e in P.check_normalizer(self.ws, self.norm(s))))

    def test_legal_only_with_complete_list_and_evidence_for_every_consumer(self):
        s = self.surface(True, internal=["program:STEP2"])
        n = self.norm(s, consumer_evidence={"program:STEP2": "app/cbl/STEP2.cbl:88 SORT on read"})
        self.assertEqual(P.check_normalizer(self.ws, n), [])

    def test_unapproved_normalizer_is_illegal(self):
        s = self.surface(True)
        n = self.norm(s)
        del n["approved_by"]
        self.assertTrue(any("approval" in e for e in P.check_normalizer(self.ws, n)))

    def test_decimal_takes_no_tolerance(self):
        s = self.surface(True, typ="decimal(9,2)")
        n = {"observable": f"{UNIT}/ACCTFILE.record_order", "erases": "tolerance", "surface": s, "approved_by": "x"}
        self.assertTrue(P.check_normalizer(self.ws, n))

    def test_encoding_normalizer_must_round_trip(self):
        s = self.surface(True)
        n = {"observable": f"{UNIT}/ACCTFILE.record_order", "erases": "encoding", "encoding": "cp037", "surface": s, "approved_by": "x"}
        self.assertEqual(P.check_normalizer(self.ws, n), [])
        n["encoding"] = "ascii-lossy"
        self.assertTrue(P.check_normalizer(self.ws, n))


# ---------------------------------------------------------------------------
# Round 2, root cause 2: the gate unit pulled in most of the system
# repros: round2/adv-1/f1_gate_unit.py, adv-2/f2_gate_unit.py, adv-3/d_gate_unit.py
# ---------------------------------------------------------------------------
class GateUnitBoundary(Base):
    def test_runtime_closure_stops_at_persistent_stores(self):
        g = {"nodes": [
            {"id": "job:INTJOB", "loc": "jcl/INTJOB.jcl:1"}, {"id": "step:INTJOB/S1", "loc": "jcl/INTJOB.jcl:3"},
            {"id": "program:CBACT04C", "loc": "cbl/CBACT04C.cbl:1"}, {"id": "dataset:ACCT", "loc": None},
            {"id": "program:READER", "loc": "cbl/READER.cbl:1"}, {"id": "job:OTHER", "loc": "jcl/OTHER.jcl:1"}],
            "edges": [
            {"from": "job:INTJOB", "to": "step:INTJOB/S1", "kind": "contains"},
            {"from": "step:INTJOB/S1", "to": "program:CBACT04C", "kind": "runs"},
            {"from": "step:INTJOB/S1", "to": "dataset:ACCT", "kind": "writes"},
            {"from": "job:OTHER", "to": "program:READER", "kind": "contains"},
            {"from": "program:READER", "to": "dataset:ACCT", "kind": "reads"}]}
        P.dump(self.ws.analysis / "graph.json", g)
        closure = P.runtime_closure(self.ws, GU, self.dir / "legacy")
        self.assertIn("cbl/CBACT04C.cbl", closure)
        self.assertNotIn("cbl/READER.cbl", closure)
        self.assertNotIn("jcl/OTHER.jcl", closure)


# ---------------------------------------------------------------------------
# Round 2, root cause 3 (round 1, root cause 1): single-value canaries miss structural bugs
# repros: round2/adv-1/f3_canary_sweep.py, adv-2/f3_canary_sweep.py, adv-3/a_canary_sweep.py,
#         round1 p3_delta_comparator.py
# ---------------------------------------------------------------------------
WEAK = {
    "zip": """
        import json, sys
        a, b = (json.load(open(p)) for p in sys.argv[1:3])
        ra, rb = a["stores"]["STMT"]["records"], b["stores"]["STMT"]["records"]
        eq = all(x == y for x, y in zip(ra, rb)) and a.get("return_code") == b.get("return_code") and a.get("abend") == b.get("abend")
        print(json.dumps({"equal": eq, "compared": ["STMT.field:*"]}))""",
    "columns": """
        import json, sys
        a, b = (json.load(open(p)) for p in sys.argv[1:3])
        ra, rb = a["stores"]["STMT"]["records"], b["stores"]["STMT"]["records"]
        cols = lambda r: {k: sorted(str(x.get(k)) for x in r) for k in (r[0] if r else {})}
        eq = len(ra) == len(rb) and cols(ra) == cols(rb) and a.get("return_code") == b.get("return_code") and a.get("abend") == b.get("abend")
        print(json.dumps({"equal": eq, "compared": ["STMT.field:*"]}))""",
    "abs": """
        import json, sys
        from decimal import Decimal
        a, b = (json.load(open(p)) for p in sys.argv[1:3])
        norm = lambda r: [{k: (str(abs(Decimal(v))) if k == "amount" and v not in (None, "") else v) for k, v in x.items()} for x in r]
        eq = norm(a["stores"]["STMT"]["records"]) == norm(b["stores"]["STMT"]["records"]) and a.get("return_code") == b.get("return_code") and a.get("abend") == b.get("abend")
        print(json.dumps({"equal": eq, "compared": ["STMT.field:*"]}))""",
}

SAMPLE = {"stores": {"STMT": {"records": [
    {"account": "00000012345", "date": "2026-10-11", "amount": "-42.10", "desc": "FUEL"},
    {"account": "00000012345", "date": "2026-10-31", "amount": "17.00", "desc": "SHOP"}]}},
    "return_code": 0, "abend": None}


class CanarySweep(Base):
    def weak(self, name):
        p = self.dir / f"{name}.py"
        p.write_text(textwrap.dedent(WEAK[name]))
        return f"{sys.executable} {p}"

    def sweep(self, comparator):
        return P.canary_sweep([SAMPLE], comparator, "STMTJOB", [], self.dir / "tmp")

    def test_zip_comparator_is_not_trusted(self):
        r = self.sweep(self.weak("zip"))
        self.assertFalse(r["trusted"])
        self.assertTrue(any("delete last record" in m for m in r["missed"]))

    def test_column_comparator_is_not_trusted(self):
        r = self.sweep(self.weak("columns"))
        self.assertFalse(r["trusted"])
        self.assertTrue(any("swap" in m or "reorder" in m for m in r["missed"]), r["missed"])

    def test_abs_comparator_is_not_trusted(self):
        r = self.sweep(self.weak("abs"))
        self.assertFalse(r["trusted"])
        self.assertTrue(any("negate" in m for m in r["missed"]))

    def test_exact_comparator_catches_every_canary(self):
        r = self.sweep("exact")
        self.assertTrue(r["trusted"], r["missed"])
        for cls in ("structural", "value", "sign_zero", "representation"):
            self.assertIn(cls, r["classes"])

    def test_lost_leading_zeros_are_a_difference(self):
        modern = json.loads(json.dumps(SAMPLE))
        modern["stores"]["STMT"]["records"][0]["account"] = "12345"
        self.assertFalse(P.exact_compare(SAMPLE, modern, "STMTJOB")["equal"])

    def test_sample_too_small_for_structural_canaries_is_not_trusted(self):
        one = {"stores": {"STMT": {"records": [SAMPLE["stores"]["STMT"]["records"][0]]}}, "return_code": 0, "abend": None}
        self.assertFalse(P.canary_sweep([one], "exact", "STMTJOB", [], self.dir / "tmp")["trusted"])


# ---------------------------------------------------------------------------
# Round 1, root cause 1 (round 2, root cause 3): a delta comparator hides undeclared differences
# repro: round1/adv-1/p3_delta_comparator.py
# ---------------------------------------------------------------------------
class DeltaTotality(Base):
    def test_unmapped_observables_fail_the_delta(self):
        d = {"id": "DELTA-007", "map": {"STMT.field:amount": "$.lines[*].amount"}, "removed": [], "added": [],
             "approved_by": "x"}
        errs = P.check_delta(self.ws, d, ["STMT.field:amount", "STMT.record_order", "STMT.cardinality"],
                             ["$.lines[*].amount", "$.links.self"])
        self.assertTrue(any("record_order" in e for e in errs))
        self.assertTrue(any("cardinality" in e for e in errs))
        self.assertTrue(any("$.links.self" in e for e in errs))

    def test_delta_must_map_open_obligations(self):  # round 2 root cause 8: lost in a split
        P.dump(self.ws.obligations / "OBL-1.json", {"id": "OBL-1", "observables": ["STMT.field:amount"],
                                                     "requirement": "hazard:invalid_packed", "status": "open"})
        d = {"map": {"STMT.field:amount": "$.amount"}, "approved_by": "x"}
        self.assertTrue(any("OBL-1" in e for e in P.check_delta(self.ws, d, ["STMT.field:amount"], ["$.amount"])))
        d["obligations_map"] = {"OBL-1": ["module:statements"]}
        self.assertEqual(P.check_delta(self.ws, d, ["STMT.field:amount"], ["$.amount"]), [])


# ---------------------------------------------------------------------------
# Round 2, root cause 4 (round 1, root cause 9): seeds in the key, and reruns that clear failures
# repros: round2/adv-1/f4_flaky_key.py, adv-2/f6_flaky.py, adv-3/b_key_seed_flaky.py, round1 p8_stale_evidence.py
# ---------------------------------------------------------------------------
class RerunsNeverClear(Base):
    def setUp(self):
        super().setUp()
        self.ids = self.pool(24)
        P.build_set(self.ws, "S", GU, "executable", self.ids, {"random": "uniform records"}, {"random": "def v1"})
        self.row = [{"n": "1"}, {"n": "2"}]

    def all_pass(self):
        for c in self.ids:
            self.observe(c, obs(self.row), obs(self.row))

    def test_a_failure_stays_after_any_number_of_passing_reruns(self):
        self.all_pass()
        self.observe(self.ids[3], obs(self.row), obs([{"n": "1"}]))
        self.run_judge("S")
        self.all_pass()
        for _ in range(10):
            P.dump(self.ws.set_path("S"), {**P.load(self.ws.set_path("S")), "failed_classes": []})
            self.run_judge("S")
        v = P.verdict(self.ws, GU, "V3", "K1", {}, False)
        self.assertEqual(v["verdict"], "FLAKY")  # same case passed and failed under one key: never PROVEN

    def test_a_deterministic_failure_is_not_proven(self):
        self.all_pass()
        self.observe(self.ids[0], obs(self.row), obs([{"n": "9"}]))
        self.run_judge("S")
        self.assertEqual(P.verdict(self.ws, GU, "V3", "K1", {}, False)["verdict"], "NOT_PROVEN")

    def test_infra_signoff_needs_two_environments_and_a_signature(self):
        self.all_pass()
        self.observe(self.ids[0], obs(self.row), obs([{"n": "9"}]))
        self.run_judge("S", env="ref-a")
        self.all_pass()
        P.dump(self.ws.set_path("S"), {**P.load(self.ws.set_path("S")), "failed_classes": []})
        self.run_judge("S", env="ref-b")
        P.dump(self.ws.evidence / "signoffs" / "s.json", {"case": self.ids[0], "signed_by": "ops lead"})
        self.assertEqual(P.verdict(self.ws, GU, "V3", "K1", {}, False)["verdict"], "PROVEN")

    def test_seeds_are_not_in_the_key(self):
        h1 = P.set_hash(P.load(self.ws.set_path("S")))
        self.all_pass()
        self.run_judge("S")  # a judge run (any seed) does not change the set unless a fresh input fails
        self.assertEqual(h1, P.set_hash(P.load(self.ws.set_path("S"))))

    def test_zero_cases_is_not_proven(self):
        P.dump(self.ws.evidence / "K0" / "r" / "run.json", {"run_id": "r", "gate_unit": GU, "mode": "executable",
               "environment": "x", "results": [], "coverage": {"observables": {}, "classes": {}, "hazards": {}, "calendar_events": [], "mismatches": []}})
        self.assertEqual(P.verdict(self.ws, GU, "V3", "K0", {}, False)["verdict"], "NOT_PROVEN")


# ---------------------------------------------------------------------------
# Round 2, root cause 5 (round 1, root cause 9): the key missed job wiring and legacy JCL
# repro: round2/adv-2/f7_evidence_key.py
# ---------------------------------------------------------------------------
class EvidenceKey(Base):
    def setUp(self):
        super().setUp()
        for p, t in {"legacy/jcl/INTJOB.jcl": "//S1 EXEC PGM=A", "legacy/cbl/A.cbl": "A", "legacy/cbl/B.cbl": "B",
                     "modernized/batch/intjob.xml": "<job/>", "modernized/StmtStep.java": "class S{}"}.items():
            (self.dir / p).parent.mkdir(parents=True, exist_ok=True)
            (self.dir / p).write_text(t)
        P.dump(self.ws.analysis / "graph.json", {"nodes": [
            {"id": "job:INTJOB", "loc": "jcl/INTJOB.jcl:1"}, {"id": "step:INTJOB/S1", "loc": "jcl/INTJOB.jcl:1"},
            {"id": "step:INTJOB/S2", "loc": "jcl/INTJOB.jcl:2"},
            {"id": "program:A", "loc": "cbl/A.cbl:1"}, {"id": "program:B", "loc": "cbl/B.cbl:1"}], "edges": [
            {"from": "job:INTJOB", "to": "step:INTJOB/S1", "kind": "contains"},
            {"from": "job:INTJOB", "to": "step:INTJOB/S2", "kind": "contains"},
            {"from": "step:INTJOB/S1", "to": "program:A", "kind": "runs"},
            {"from": "step:INTJOB/S2", "to": "program:B", "kind": "runs"}]})
        self.modern = ["modernized/batch/intjob.xml", "modernized/StmtStep.java"]

    def key(self, rung="V3", env=None):
        return P.evidence_key(self.ws, GU, rung, self.dir / "legacy", self.modern, None, [], {"cobol-zos": "1"},
                              env or {"collation": "EBCDIC"})["key"]

    def test_editing_any_step_wiring_or_jcl_changes_the_key(self):
        for p in ("legacy/cbl/B.cbl", "legacy/jcl/INTJOB.jcl", "modernized/batch/intjob.xml", "modernized/StmtStep.java"):
            before = self.key()
            (self.dir / p).write_text((self.dir / p).read_text() + " edited")
            self.assertNotEqual(before, self.key(), p)

    def test_environment_holds_semantic_settings_only(self):
        self.assertEqual(self.key(env={"collation": "EBCDIC"}), self.key(env={"collation": "EBCDIC"}))
        self.assertNotEqual(self.key(env={"collation": "EBCDIC"}), self.key(env={"collation": "ASCII"}))

    def test_new_consumer_invalidates_normalizer_evidence(self):  # round 2 dropped idea, adv-3
        s = self.surface(True, internal=["program:STEP2"])
        P.dump(self.dir / "oracles/sys/normalizers/NORM-1.json", {"surface": s, "erases": "order"})
        k1 = P.evidence_key(self.ws, GU, "V3", self.dir / "legacy", [], None, ["oracles/sys/normalizers/NORM-1.json"], {}, {})["key"]
        self.surface(True, internal=["program:STEP2", "program:NEWREADER"])
        k2 = P.evidence_key(self.ws, GU, "V3", self.dir / "legacy", [], None, ["oracles/sys/normalizers/NORM-1.json"], {}, {})["key"]
        self.assertNotEqual(k1, k2)


# ---------------------------------------------------------------------------
# Round 2, root cause 6 (round 1, root cause 7): no oracle supply when legacy cannot run
# repros: round2/adv-2/f5_recorded_only_starve.py, adv-1/f8_sealed_burn.py, round1 p6_policy_deadlock.py
# ---------------------------------------------------------------------------
class RecordedMode(Base):
    def test_recorded_mode_reaches_provisional_with_accepted_obligations_never_proven(self):
        row = [{"n": "1"}, {"n": "2"}]
        ids = [self.case(i, expected=obs(row)) for i in range(8)]
        s = P.build_set(self.ws, "R", GU, "recorded", ids, {"random": "recorded traffic"}, {})
        self.assertEqual(len(s["sealed"]), 2)  # 25% of the pool, no minimum
        for c in ids:
            P.dump(self.dir / "M" / f"{c}.json", obs(row))
        self.run_judge("R")
        req = {"hazards": ["rounded"]}
        v = P.verdict(self.ws, GU, "V3", "K1", req, write_obligations=True)
        self.assertEqual(v["verdict"], "NOT_PROVEN")  # the hazard gap is an obligation nobody accepted yet
        for p in self.ws.obligations.glob("OBL-*.json"):
            P.dump(p, {**P.load(p), "accepted_by": "a person"})
        self.assertEqual(P.verdict(self.ws, GU, "V3", "K1", req, False)["verdict"], "PROVISIONAL")
        self.assertEqual(P.verdict(self.ws, GU, "V3", "K1", {}, False)["verdict"], "PROVISIONAL")

    def test_executable_mode_requires_a_real_sealed_set(self):
        with self.assertRaises(P.Bad):
            P.build_set(self.ws, "E", GU, "executable", self.pool(10), {}, {})


# ---------------------------------------------------------------------------
# Round 2, root cause 7 (round 1, root cause 2): revealed sealed cases were patched and drained
# repros: round2/adv-2/f4_patch_revealed_case.py, adv-3/c_burn_starve.py, round1 p1_heldout_leak.py
# ---------------------------------------------------------------------------
class SealedAndJudge(Base):
    def setUp(self):
        super().setUp()
        self.ids = self.pool(24)
        P.build_set(self.ws, "S", GU, "executable", self.ids, {"random": "uniform records"}, {"random": "def"})
        for c in self.ids:
            self.observe(c, obs([{"v": "1"}]), obs([{"v": "1"}]))

    def test_judge_output_holds_counts_and_descriptions_only(self):
        self.observe(self.ids[5], obs([{"v": "SECRET-EXPECTED"}]), obs([{"v": "SECRET-ACTUAL"}]))
        out = json.dumps(self.run_judge("S"))
        self.assertNotIn("SECRET", out)
        for cid in self.ids:
            self.assertNotIn(cid, out)
        self.assertIn("uniform records", out)

    def test_sealed_cases_never_move_and_failing_fresh_inputs_join_them(self):
        sealed = set(P.load(self.ws.set_path("S"))["sealed"])
        f = self.case(99, classes=("random",))
        self.observe(f, obs([{"v": "1"}]), obs([{"v": "2"}]))
        self.run_judge("S", fresh=[f])
        s = P.load(self.ws.set_path("S"))
        self.assertTrue(sealed <= set(s["sealed"]))
        self.assertIn(f, s["sealed"])
        self.assertNotIn(f, s["dev"])

    def test_a_failed_class_must_return_with_fresh_inputs(self):
        self.observe(self.ids[0], obs([{"v": "1"}]), obs([{"v": "2"}]))
        self.run_judge("S")
        with self.assertRaises(P.Bad):
            self.run_judge("S")  # no fresh input from class "random"

    def test_memorised_cases_without_fresh_inputs_leave_a_gap(self):
        self.run_judge("S")
        v = P.verdict(self.ws, GU, "V4", "K1", {"fresh_classes": ["random"]}, False)
        self.assertEqual(v["verdict"], "NOT_PROVEN")


# ---------------------------------------------------------------------------
# Round 2, root cause 8: obligations discharged without exercising the risk
# repros: round2/adv-1/f5_obligation_discharge.py, adv-2/f10_obligation_discharge.py, adv-3/e_obligation_deadlock.py
# ---------------------------------------------------------------------------
class Obligations(Base):
    def setUp(self):
        super().setUp()
        P.dump(self.ws.obligations / "OBL-PACKED.json", {"id": "OBL-PACKED", "observables": [f"{UNIT}/ACCTFILE.field:amt"],
               "requirement": "hazard:invalid_packed", "min_count": 2, "accepted_by": "x", "status": "open"})
        self.ids = self.pool(24)
        P.build_set(self.ws, "S", GU, "executable", self.ids, {}, {})
        for c in self.ids:
            self.observe(c, obs([{"amt": "1.00"}]), obs([{"amt": "1.00"}]))

    def test_a_run_that_never_hit_the_hazard_does_not_discharge(self):
        self.run_judge("S")
        self.assertEqual(P.discharge(self.ws)[0]["status"], "open")

    def test_only_enough_passing_hazard_inputs_discharge(self):
        hz = [self.case(100 + i, classes=("hazard:invalid_packed",)) for i in range(2)]
        for c in hz:
            self.observe(c, obs([{"amt": "ABEND"}]), obs([{"amt": "ABEND"}]))
        self.run_judge("S", key="K-LATER", fresh=hz)  # any later gate unit or environment may discharge
        self.assertEqual(P.discharge(self.ws)[0]["status"], "discharged")

    def test_a_mismatch_on_the_hazard_blocks_discharge(self):
        hz = [self.case(100 + i, classes=("hazard:invalid_packed",)) for i in range(3)]
        for c in hz[:2]:
            self.observe(c, obs([{"amt": "ABEND"}]), obs([{"amt": "ABEND"}]))
        self.observe(hz[2], obs([{"amt": "ABEND"}]), obs([{"amt": "73.40"}]))
        self.run_judge("S", fresh=hz)
        self.assertEqual(P.discharge(self.ws)[0]["status"], "open")


# ---------------------------------------------------------------------------
# Round 2, root cause 9 (round 1, root cause 8): the window ended without a month-end
# repros: round2/adv-1/f6_calendar_parm.py, adv-2/f8_calendar.py, adv-3/f_calendar_dow.py, round1 p7_estep_window.py
# ---------------------------------------------------------------------------
class Calendar(Base):
    def test_events_from_the_clock(self):
        self.assertIn("weekday_fri", P.calendar_events("2026-11-13T02:00:00"))
        self.assertIn("month_end_30", P.calendar_events("2026-11-30T23:00:00"))
        self.assertIn("month_end_feb", P.calendar_events("2028-02-29T23:00:00"))
        self.assertIn("quarter_end", P.calendar_events("2026-12-31T23:00:00"))
        self.assertIn("run_mode_ME", P.calendar_events("2026-11-30T23:00:00", {"PARM-CYCLE": "ME"}))

    def test_one_day_does_not_cover_the_minimum_window(self):
        ids = self.pool(24, clock="2026-11-09T02:00:00")
        P.build_set(self.ws, "S", GU, "executable", ids, {}, {})
        for c in ids:
            self.observe(c, obs([{"v": "1"}]), obs([{"v": "1"}]))
        self.run_judge("S")
        v = P.verdict(self.ws, GU, "V10", "K1", {"calendar_events": P.MINIMUM_WINDOW}, False)
        self.assertEqual(v["verdict"], "NOT_PROVEN")
        self.assertTrue(any("month_end_31" in r for r in v["reasons"]))


# ---------------------------------------------------------------------------
# Round 1, root cause 4: generators and rule coverage miss construct semantics
# repro: round1/adv-1/p2_mutation_antistub.py (and the hazard rows of round 2)
# ---------------------------------------------------------------------------
class HazardCoverage(Base):
    def test_every_required_hazard_must_be_reached(self):
        ids = self.pool(24)
        P.build_set(self.ws, "S", GU, "executable", ids, {}, {})
        for c in ids:
            self.observe(c, obs([{"v": "1"}]), obs([{"v": "1"}]))
        self.run_judge("S")
        v = P.verdict(self.ws, GU, "V4", "K1", {"hazards": ["rounded", "size_error"]}, False)
        self.assertEqual(v["verdict"], "NOT_PROVEN")
        self.assertEqual(len(v["gaps"]), 2)


# ---------------------------------------------------------------------------
# Content addressing (round 2 dropped ideas: hidden inputs, clock, session)
# ---------------------------------------------------------------------------
class ContentAddressing(Base):
    def test_inputs_that_differ_only_in_clock_or_store_are_different_cases(self):
        a = P.case_id(inp(clock="2026-11-29T02:00:00"))
        self.assertNotEqual(a, P.case_id(inp(clock="2026-11-30T02:00:00")))
        self.assertNotEqual(a, P.case_id(inp(clock="2026-11-29T02:00:00", stores={"ACCT": "sha256:1"})))

    def test_a_case_must_state_every_input(self):
        with self.assertRaises(P.Bad):
            P.case_id({"records": {}, "params": {}})


# Owned elsewhere (no script to test):
#   round 2 #10 capability preflight -> commands/preflight.md (smoke runs, per construct)
#   round 2 #11 generalisation check -> deleted in v0.3; nothing to test
#   round 1 #5 data step V7, #6 Pack interfaces -> M6 (store probes) and commands/preflight.md

if __name__ == "__main__":
    unittest.main()
