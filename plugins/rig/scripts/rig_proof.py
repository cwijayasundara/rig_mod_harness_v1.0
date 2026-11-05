#!/usr/bin/env python3
"""RIG proof core (docs/PROPOSAL.md §5.3, §6). Standard library only.

Claude writes oracles, generators, comparators and normalizers, and runs both
sides. This script decides: it hashes cases, splits dev and sealed sets, runs
comparisons, writes evidence with coverage, and computes every verdict. Its
output is the only verdict that counts.

    python3 rig_proof.py <command> --ws <workspace> --system <name> [options]

Commands
  case add       add a case (content-addressed by its canonical input)
  set build      build or extend a dev/sealed oracle set for a gate unit
  judge          compare legacy and modern observations, record a run, print counts per class
  key            compute the evidence key of a gate unit and rung
  normalizer     check a normalizer against the consumer rules
  delta          check a delta's totality and obligation mapping
  canary         run the canary sweep against a comparator
  verdict        compute the verdict of a gate unit and rung from every run under its key
  obligations    discharge obligations by coverage, and list what is open
  calendar       required calendar events for a gate unit and which runs covered them

Every command prints JSON and exits 0 when its check passes, 1 when it fails, 2 on bad input.
"""

from __future__ import annotations

import argparse
import calendar as cal
import copy
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path

# ---------------------------------------------------------------------------
# Basics
# ---------------------------------------------------------------------------

INPUT_KEYS = ("records", "params", "clock", "stores", "session")
RUNGS = ("V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10")
ORACLE_RUNGS = {"V2", "V3", "V4", "V6"}
COMPARATOR_RUNGS = {"V3", "V4", "V5"}
SEALED_MIN = 20
SEALED_SHARE = 0.25


class Bad(Exception):
    """Bad input: exit 2."""


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(text: str | bytes) -> str:
    return hashlib.sha256(text.encode() if isinstance(text, str) else text).hexdigest()


def load(path) -> dict:
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        raise Bad(f"missing {path}") from None
    except json.JSONDecodeError as e:
        raise Bad(f"{path}: {e}") from None


def dump(path, obj) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, p)


class WS:
    def __init__(self, root: str, system: str):
        self.root = Path(root).resolve()
        self.system = system
        self.oracles = self.root / "oracles" / system
        self.evidence = self.root / "evidence" / system
        self.analysis = self.root / "analysis" / system
        self.obligations = self.root / "obligations" / system

    def case_path(self, cid: str) -> Path:
        return self.oracles / "cases" / f"{cid}.json"

    def case(self, cid: str) -> dict:
        return load(self.case_path(cid))

    def set_path(self, name: str) -> Path:
        return self.oracles / "sets" / f"{name}.json"


# ---------------------------------------------------------------------------
# Cases and sets (§6.1, §5.3)
# ---------------------------------------------------------------------------


def canonical_input(inp: dict) -> dict:
    """Every input to the unit is part of the case: records, parameters, clock, store snapshots, session."""
    missing = [k for k in INPUT_KEYS if k not in inp]
    if missing:
        raise Bad(f"canonical input lacks {missing}: a case must include every input (use null or {{}} for none)")
    extra = sorted(set(inp) - set(INPUT_KEYS))
    if extra:
        raise Bad(f"canonical input has unknown keys {extra}")
    if inp["clock"] is not None:
        try:
            dt.datetime.fromisoformat(inp["clock"])
        except (TypeError, ValueError):
            raise Bad(f"clock must be an ISO date-time, got {inp['clock']!r}") from None
    return inp


def case_id(inp: dict) -> str:
    return sha(canon(canonical_input(inp)))


def add_case(ws: WS, inp: dict, classes: list[str], origin: str, expected: dict | None) -> dict:
    cid = case_id(inp)
    p = ws.case_path(cid)
    if p.exists():
        c = load(p)
        c["classes"] = sorted(set(c["classes"]) | set(classes))
        if expected is not None and c.get("expected") not in (None, expected):
            raise Bad(f"case {cid[:12]} already has a different expected output")
        if expected is not None:
            c["expected"] = expected
    else:
        c = {"id": cid, "input": inp, "expected": expected, "classes": sorted(set(classes)), "origin": origin}
    dump(p, c)
    return c


def build_set(ws: WS, name: str, gate_unit: str, mode: str, pool: list[str], required: dict[str, str],
              generators: dict[str, str]) -> dict:
    """Split a pool into dev and sealed by input hash. Sealed cases never move (§5.3 rule 2)."""
    if mode not in ("executable", "recorded"):
        raise Bad("mode must be executable or recorded")
    p = ws.set_path(name)
    old = load(p) if p.exists() else None
    sealed = set(old["sealed"]) if old else set()
    dev = set(old["dev"]) if old else set()
    for cid in pool:
        c = ws.case(cid)
        if mode == "recorded" and c.get("expected") is None:
            raise Bad(f"recorded mode: case {cid[:12]} has no recorded expected output")
    new = sorted(set(pool) - sealed - dev)
    total = len(sealed | dev) + len(new)
    want = max(SEALED_MIN, -(-total * SEALED_SHARE // 1)) if mode == "executable" else -(-total * SEALED_SHARE // 1)
    want = int(want)
    for cid in new:  # sorted by hash, so the split is deterministic and not chosen by anyone
        (sealed if len(sealed) < want else dev).add(cid)
    if mode == "executable" and len(sealed) < SEALED_MIN:
        raise Bad(f"executable mode needs at least {SEALED_MIN} sealed cases; the pool gives {len(sealed)}")
    s = {
        "name": name, "gate_unit": gate_unit, "mode": mode, "dev": sorted(dev), "sealed": sorted(sealed),
        "required_classes": dict(sorted(required.items())), "generators": dict(sorted(generators.items())),
        "failed_classes": old.get("failed_classes", []) if old else [],
    }
    dump(p, s)
    return s


def set_hash(s: dict) -> str:
    """Case ids and generator definitions only. Never per-run seeds (§6.5)."""
    return sha(canon({"dev": s["dev"], "sealed": s["sealed"], "generators": s["generators"]}))


# ---------------------------------------------------------------------------
# Observations and the built-in comparator
# ---------------------------------------------------------------------------
#
# Observations of one run of one case:
#   {"stores": {"<store>": {"records": [{"<field>": "<value>"}, ...]}},
#    "return_code": 0, "abend": null, "messages": ["..."], "screens": [{...}]}
# Values are strings. A decimal is "123.40", never a float.


def observable_ids(obs: dict, unit: str) -> list[str]:
    ids = [f"{unit}.return_code", f"{unit}.abend"]
    for store, body in sorted(obs.get("stores", {}).items()):
        ids += [f"{unit}/{store}.store_write", f"{unit}/{store}.cardinality", f"{unit}/{store}.record_order"]
        fields = sorted({f for r in body.get("records", []) for f in r})
        ids += [f"{unit}/{store}.field:{f}" for f in fields]
    if obs.get("messages") is not None:
        ids.append(f"{unit}.message")
    if obs.get("screens") is not None:
        ids.append(f"{unit}.screen")
    return ids


def apply_normalizers(obs: dict, norms: list[dict]) -> dict:
    o = copy.deepcopy(obs)
    for n in norms:
        store = n.get("store")
        recs = o.get("stores", {}).get(store, {}).get("records") if store else None
        if n["erases"] == "order" and recs is not None:
            recs.sort(key=canon)
        elif n["erases"] == "field" and recs is not None:
            for r in recs:
                if n["field"] in r:
                    r[n["field"]] = "<masked>"
        elif n["erases"] == "encoding":
            pass  # encoding normalizers convert before observations are written; here they only gate legality
    return o


def _num(v):
    try:
        return Decimal(v)
    except (InvalidOperation, TypeError, ValueError):
        return None


def exact_compare(legacy: dict, modern: dict, unit: str, tolerances: dict[str, Decimal] | None = None) -> dict:
    """Compare every observable. Returns {equal, compared, diffs}. Cardinality and order are separate observables."""
    tolerances = tolerances or {}
    compared, diffs = [], []

    def cmp(oid, a, b, tol=None):
        compared.append(oid)
        if tol is not None and _num(a) is not None and _num(b) is not None:
            if abs(_num(a) - _num(b)) > tol:
                diffs.append(oid)
        elif a != b:
            diffs.append(oid)

    cmp(f"{unit}.return_code", legacy.get("return_code"), modern.get("return_code"))
    cmp(f"{unit}.abend", legacy.get("abend"), modern.get("abend"))
    if legacy.get("messages") is not None or modern.get("messages") is not None:
        cmp(f"{unit}.message", legacy.get("messages"), modern.get("messages"))
    if legacy.get("screens") is not None or modern.get("screens") is not None:
        cmp(f"{unit}.screen", legacy.get("screens"), modern.get("screens"))
    ls, ms = legacy.get("stores", {}), modern.get("stores", {})
    for store in sorted(set(ls) | set(ms)):
        base = f"{unit}/{store}"
        a = ls.get(store, {}).get("records")
        b = ms.get(store, {}).get("records")
        cmp(f"{base}.store_write", a is not None, b is not None)
        a, b = a or [], b or []
        cmp(f"{base}.cardinality", len(a), len(b))
        cmp(f"{base}.record_order", [canon(r) for r in a], [canon(r) for r in b])
        fields = sorted({f for r in a + b for f in r})
        for f in fields:
            oid = f"{base}.field:{f}"
            col_a = [r.get(f) for r in a]
            col_b = [r.get(f) for r in b]
            # Compare as a multiset of whole records' field values, so a reorder alone shows in record_order,
            # and a value moved between records shows here (record identity is the rest of the record).
            pairs_a = sorted(canon([r.get(f), {k: v for k, v in r.items() if k != f}]) for r in a)
            pairs_b = sorted(canon([r.get(f), {k: v for k, v in r.items() if k != f}]) for r in b)
            tol = tolerances.get(oid)
            if tol is not None and len(col_a) == len(col_b):
                compared.append(oid)
                if any(_num(x) is None or _num(y) is None or abs(_num(x) - _num(y)) > tol for x, y in zip(col_a, col_b)):
                    diffs.append(oid)
            else:
                cmp(oid, pairs_a, pairs_b)
    return {"equal": not diffs, "compared": sorted(set(compared)), "diffs": sorted(set(diffs))}


def run_comparator(spec: str | None, legacy: dict, modern: dict, unit: str, tmp: Path) -> dict:
    """`exact` (built in) or a command `<cmd> legacy.json modern.json` that prints {equal, compared}."""
    if not spec or spec == "exact":
        return exact_compare(legacy, modern, unit)
    tmp.mkdir(parents=True, exist_ok=True)
    la, mb = tmp / f"l-{uuid.uuid4().hex}.json", tmp / f"m-{uuid.uuid4().hex}.json"
    la.write_text(canon(legacy))
    mb.write_text(canon(modern))
    try:
        out = subprocess.run([*spec.split(), str(la), str(mb)], capture_output=True, text=True, timeout=120)
    finally:
        la.unlink(missing_ok=True)
        mb.unlink(missing_ok=True)
    try:
        r = json.loads(out.stdout)
    except json.JSONDecodeError:
        raise Bad(f"comparator {spec!r} did not print JSON: {out.stderr[:200]}") from None
    if not isinstance(r.get("compared"), list):
        raise Bad("a comparator must report the observables it compared (Rule B)")
    return {"equal": bool(r.get("equal")), "compared": sorted(r["compared"]), "diffs": r.get("diffs", [])}


# ---------------------------------------------------------------------------
# Calendar (§6.6)
# ---------------------------------------------------------------------------

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
MINIMUM_WINDOW = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri",
                  "month_end_30", "month_end_31", "month_end_feb", "quarter_end"]


def calendar_events(clock: str | None, params: dict | None = None) -> list[str]:
    if not clock:
        return []
    d = dt.datetime.fromisoformat(clock).date()
    ev = [f"weekday_{WEEKDAYS[d.weekday()]}"]
    last = cal.monthrange(d.year, d.month)[1]
    if d.day == last:
        ev.append("month_end_feb" if d.month == 2 else f"month_end_{last}")
        if d.month in (3, 6, 9, 12):
            ev.append("quarter_end")
        if d.month == 12:
            ev.append("year_end")
    if d.month == 2 and d.day == 29:
        ev.append("leap_day")
    for k, v in sorted((params or {}).items()):
        if k.lower().startswith("run_mode") or k.upper() in ("PARM-CYCLE", "CYCLE", "RUN-MODE"):
            ev.append(f"run_mode_{v}")
    return ev


# ---------------------------------------------------------------------------
# Judge (§5.3)
# ---------------------------------------------------------------------------


def judge(ws: WS, set_name: str, key: str, legacy_dir: Path, modern_dir: Path, fresh: list[str],
          comparator: str | None, normalizers: list[dict], env_id: str) -> dict:
    """Compare every case of the run, write the run with its coverage, and return counts per class only."""
    s = load(ws.set_path(set_name))
    unit = s["gate_unit"].split(":", 1)[-1]
    known = set(s["dev"]) | set(s["sealed"])
    fresh = sorted(set(fresh) - known)
    cases = sorted(known | set(fresh))
    # A class that failed last time must come back with new inputs (§5.3 rule 3).
    fresh_classes = {cl for cid in fresh for cl in ws.case(cid)["classes"]}
    missing_retry = sorted(set(s.get("failed_classes", [])) - fresh_classes)
    if missing_retry:
        raise Bad(f"classes that failed last run need fresh inputs this run: {missing_retry}")

    results, coverage = [], {"observables": {}, "classes": {}, "hazards": {}, "calendar_events": [], "mismatches": []}
    tmp = ws.evidence / ".tmp"
    for cid in cases:
        c = ws.case(cid)
        lpath, mpath = legacy_dir / f"{cid}.json", modern_dir / f"{cid}.json"
        if not mpath.exists():
            raise Bad(f"no modern observation for case {cid[:12]}")
        modern = load(mpath)
        if lpath.exists():
            legacy = load(lpath)
        elif c.get("expected") is not None:
            legacy = c["expected"]
        else:
            legacy = None  # recorded mode, generated input: no legacy output exists
        if legacy is None:
            ok = modern.get("abend") is None and modern.get("crash") is None
            r = {"case": cid, "classes": c["classes"], "pass": ok, "compared": [], "property_only": True}
        else:
            cmpd = run_comparator(comparator, apply_normalizers(legacy, normalizers),
                                  apply_normalizers(modern, normalizers), unit, tmp)
            r = {"case": cid, "classes": c["classes"], "pass": cmpd["equal"], "compared": cmpd["compared"]}
            for oid in cmpd["compared"]:
                coverage["observables"][oid] = coverage["observables"].get(oid, 0) + 1
        r["fresh"] = cid in fresh
        results.append(r)
        for cl in c["classes"]:
            coverage["classes"][cl] = coverage["classes"].get(cl, 0) + 1
            if cl.startswith("hazard:"):
                coverage["hazards"][cl[7:]] = coverage["hazards"].get(cl[7:], 0) + 1
        coverage["calendar_events"] += calendar_events(c["input"].get("clock"), c["input"].get("params"))
        if not r["pass"]:
            coverage["mismatches"].append(cid)
    coverage["calendar_events"] = sorted(set(coverage["calendar_events"]))

    run_id = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6]
    run = {"run_id": run_id, "key": key, "set": set_name, "gate_unit": s["gate_unit"], "mode": s["mode"],
           "environment": env_id, "results": results, "coverage": coverage}
    dump(ws.evidence / key / run_id / "run.json", run)

    # Failing fresh inputs join the sealed set for good (§5.3 rule 4). Sealed cases never move.
    failed_fresh = [r["case"] for r in results if r["fresh"] and not r["pass"]]
    s["sealed"] = sorted(set(s["sealed"]) | set(failed_fresh))
    for cid in failed_fresh:
        c = ws.case(cid)
        c["origin"] = "fresh_failure"
        dump(ws.case_path(cid), c)
    s["failed_classes"] = sorted({cl for r in results if not r["pass"] for cl in r["classes"]})
    dump(ws.set_path(set_name), s)

    descriptions = s["required_classes"]
    counts = {}
    for r in results:
        for cl in r["classes"]:
            k = counts.setdefault(cl, {"class": cl, "description": descriptions.get(cl, ""), "passed": 0, "total": 0})
            k["total"] += 1
            k["passed"] += bool(r["pass"])
    # Counts and class descriptions only: never an input, an expected output, or a diff.
    return {"run_id": run_id, "classes": sorted(counts.values(), key=lambda x: x["class"]),
            "passed": sum(r["pass"] for r in results), "total": len(results)}


# ---------------------------------------------------------------------------
# Evidence keys (§6.5)
# ---------------------------------------------------------------------------


def runtime_closure(ws: WS, gate_unit: str, legacy_root: Path) -> list[str]:
    """Legacy files in the gate unit's runtime closure, from graph.json: job, steps, programs, includes,
    PROCs, control cards and schedule entries. Unknown nodes are listed by id so the key still changes."""
    g = load(ws.analysis / "graph.json")
    out_edges = {}
    for e in g["edges"]:
        out_edges.setdefault(e["from"], []).append(e)
    nodes = {n["id"]: n for n in g["nodes"]}
    follow = {"contains", "runs", "expands", "includes", "calls", "transfers", "links", "starts", "entry",
              "has_record", "uses_psb", "maps_to", "reads", "writes", "binds", "accesses_unknown", "submits"}
    seen, stack = set(), [gate_unit]
    for e in g["edges"]:  # schedules point at the job
        if e["kind"] == "schedules" and e["to"] == gate_unit:
            stack.append(e["from"])
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        kind = nid.split(":", 1)[0]
        if kind in ("dataset", "table", "mq_queue", "td_queue", "external", "sysout"):
            continue  # stores are the boundary
        for e in out_edges.get(nid, []):
            if e["kind"] in follow:
                stack.append(e["to"])
    files = set()
    for nid in seen:
        n = nodes.get(nid, {})
        loc = n.get("loc")
        if loc:
            files.add(loc.rsplit(":", 1)[0])
        else:
            files.add(f"<node {nid} {n.get('attrs', {}).get('source', '')}>")
    return sorted(files)


def hash_files(paths: list[str], base: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(paths):
        h.update(p.encode() + b"\0")
        fp = base / p
        if p.startswith("<") or not fp.is_file():
            h.update(b"<absent>")
        else:
            h.update(fp.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def evidence_key(ws: WS, gate_unit: str, rung: str, legacy_root: Path, modern: list[str], oracle_set: str | None,
                 comparators: list[str], packs: dict, environment: dict) -> dict:
    if rung not in RUNGS:
        raise Bad(f"rung must be one of {RUNGS}")
    closure = runtime_closure(ws, gate_unit, legacy_root)
    fields = {
        "gate_unit": gate_unit,
        "rung": rung,
        "runtime_closure": sha(hash_files(closure, legacy_root) + hash_files(modern, ws.root)),
        "oracle": set_hash(load(ws.set_path(oracle_set))) if rung in ORACLE_RUNGS and oracle_set else None,
        "comparators": sha(canon([_comparator_material(ws, c) for c in sorted(comparators)])) if rung in COMPARATOR_RUNGS else None,
        "packs": sha(canon(packs)),
        "environment": sha(canon({k: environment[k] for k in sorted(environment)})),
    }
    return {"key": sha(canon(fields))[:32], "fields": fields, "closure": closure}


def _comparator_material(ws: WS, path: str) -> dict:
    """A normalizer or delta file, plus the consumer lists it relies on, so a new consumer invalidates it."""
    p = ws.root / path
    body = p.read_text() if p.is_file() else f"<absent {path}>"
    consumers = None
    if p.suffix == ".json" and p.is_file():
        n = json.loads(body)
        surf = n.get("surface")
        if surf and (ws.root / surf).is_file():
            s = load(ws.root / surf)
            consumers = {o["id"]: o.get("consumers") for o in s.get("observables", [])}
    return {"path": path, "body": sha(body), "consumers": consumers}


# ---------------------------------------------------------------------------
# Normalizers and deltas (§6.2, §6.3, §6.7)
# ---------------------------------------------------------------------------

ENCODINGS = {"cp037": ("cp037", "utf-8"), "cp1047": ("cp1047", "utf-8"), "cp500": ("cp500", "utf-8")}


def check_normalizer(ws: WS, n: dict) -> list[str]:
    """Return the reasons the normalizer is illegal (empty means legal)."""
    errs = []
    if not n.get("approved_by"):
        errs.append("no human approval (approved_by)")
    surf = load(ws.root / n["surface"]) if n.get("surface") else None
    obs = {o["id"]: o for o in (surf or {}).get("observables", [])}
    target = obs.get(n.get("observable", ""))
    if target is None:
        errs.append(f"observable {n.get('observable')!r} is not on the surface {n.get('surface')!r}")
        return errs
    erases = n.get("erases")
    if erases in ("order", "field"):
        cons = target.get("consumers", {})
        if cons.get("complete") is not True:
            errs.append("consumer list is not complete, so an unknown consumer depends on everything (Rule A)")
        aspect = "record_order" if erases == "order" else f"field:{n.get('field')}"
        for ext in cons.get("external", []):
            dep = ext.get("depends_on") or ["*"]
            if any(d in ("*", aspect) or (d == "field:*" and erases == "field") for d in dep):
                errs.append(f"external consumer {ext.get('name')} depends on {aspect}")
        evidence = n.get("consumer_evidence", {})
        for ic in cons.get("internal", []):
            if ic not in evidence:
                errs.append(f"internal consumer {ic} has no cited evidence that it does not depend on {aspect}")
    elif erases == "tolerance":
        t = target.get("type", "")
        if not t.startswith("float"):
            errs.append(f"tolerance on {t}: only floating-point observables whose legacy type is floating point may have one")
    elif erases == "encoding":
        enc = n.get("encoding")
        if enc not in ENCODINGS:
            errs.append(f"unknown encoding {enc!r}; known: {sorted(ENCODINGS)}")
        else:
            src, _ = ENCODINGS[enc]
            sample = bytes(range(256))
            try:
                if sample.decode(src).encode(src) != sample:
                    errs.append("encoding round trip is lossy")
            except (UnicodeDecodeError, UnicodeEncodeError):
                errs.append("encoding round trip is lossy")
    else:
        errs.append(f"unknown normalizer kind erases={erases!r}")
    return errs


def check_delta(ws: WS, d: dict, legacy_ids: list[str], modern_ids: list[str]) -> list[str]:
    errs = []
    mp = d.get("map", {})
    removed, added = set(d.get("removed", [])), set(d.get("added", []))
    for lid in legacy_ids:
        if lid not in mp and lid not in removed:
            errs.append(f"legacy observable {lid} is neither mapped nor removed")
    targets = set(mp.values())
    for mid in modern_ids:
        if mid not in targets and mid not in added:
            errs.append(f"modern observable {mid} is neither mapped nor added")
    if not d.get("approved_by"):
        errs.append("no human approval (approved_by)")
    # Every open obligation on the delta's legacy observables must be mapped to the new units (§6.7).
    omap = d.get("obligations_map", {})
    for ob in load_obligations(ws):
        if ob.get("status") == "discharged":
            continue
        if set(ob["observables"]) & set(legacy_ids) and ob["id"] not in omap:
            errs.append(f"open obligation {ob['id']} is not mapped to the new units")
    return errs


# ---------------------------------------------------------------------------
# Canary sweep (§6.3)
# ---------------------------------------------------------------------------


def _bump(v: str) -> str:
    n = _num(v)
    if n is not None:
        exp = n.as_tuple().exponent
        step = Decimal(1).scaleb(exp if isinstance(exp, int) else 0)
        out = n + step
        return f"{out:f}" if not v.startswith("0") or "." in v else str(out).zfill(len(v))
    return (v[:-1] + ("A" if v[-1:] != "A" else "B")) if v else "X"


def _repr_variants(v: str) -> list[tuple[str, str]]:
    out = []
    if re.fullmatch(r"0\d+", v):
        out.append(("strip_padding", v.lstrip("0") or "0"))
    if re.fullmatch(r"-?\d+\.\d*0", v):
        out.append(("change_scale", v.rstrip("0").rstrip(".")))
    if re.fullmatch(r"-\d+(\.\d+)?", v):
        out.append(("sign_trailing", v[1:] + "-"))
    if v.endswith(" ") or v.startswith(" "):
        out.append(("trim", v.strip()))
    return out


def canary_mutations(obs: dict, correlated: list[dict]) -> list[tuple[str, str, dict]]:
    """(class, description, mutated observation). Each must make the comparator report a difference."""
    out = []
    stores = obs.get("stores", {})
    for store, body in sorted(stores.items()):
        recs = body.get("records", [])

        def with_recs(new, _store=store):
            m = copy.deepcopy(obs)
            m["stores"][_store]["records"] = new
            return m

        if recs:
            out.append(("structural", f"{store}: delete last record", with_recs(recs[:-1])))
            out.append(("structural", f"{store}: duplicate a record", with_recs(recs + [copy.deepcopy(recs[-1])])))
            out.append(("structural", f"{store}: insert a record", with_recs([copy.deepcopy(recs[0])] + recs)))
            out.append(("structural", f"{store}: empty the collection", with_recs([])))
        if len(recs) >= 2 and canon(recs[0]) != canon(recs[1]):
            out.append(("structural", f"{store}: reorder records", with_recs([recs[1], recs[0]] + recs[2:])))
            for f in sorted(recs[0]):
                if recs[0].get(f) != recs[1].get(f):
                    r = copy.deepcopy(recs)
                    r[0][f], r[1][f] = r[1][f], r[0][f]
                    out.append(("structural", f"{store}: swap {f} between two records", with_recs(r)))
                    break
        for f in sorted({k for r in recs for k in r}):
            idx = next((i for i, r in enumerate(recs) if r.get(f) not in (None, "")), None)
            if idx is None:
                continue
            v = recs[idx][f]

            def set_val(nv, _f=f, _i=idx):
                r = copy.deepcopy(recs)
                r[_i][_f] = nv
                return with_recs(r)

            out.append(("value", f"{store}.{f}: smallest change", set_val(_bump(v))))
            if _num(v) is not None:
                out.append(("value", f"{store}.{f}: double", set_val(f"{_num(v) * 2:f}")))
                out.append(("sign_zero", f"{store}.{f}: negate", set_val(f"{-_num(v):f}" if _num(v) != 0 else "1")))
                out.append(("sign_zero", f"{store}.{f}: zero", set_val("0" if _num(v) != 0 else "1")))
            out.append(("sign_zero", f"{store}.{f}: null", set_val(None)))
            for name, nv in _repr_variants(v):
                out.append(("representation", f"{store}.{f}: {name}", set_val(nv)))
    for g in correlated:  # {"store", "detail", "total"}: change one detail and recompute the total
        recs = stores.get(g["store"], {}).get("records", [])
        if not recs:
            continue
        r = copy.deepcopy(recs)
        d = _num(r[0].get(g["detail"]))
        if d is None:
            continue
        r[0][g["detail"]] = f"{d + 1:f}"
        for x in r:
            if _num(x.get(g["total"])) is not None:
                x[g["total"]] = f"{_num(x[g['total']]) + 1:f}"
        m = copy.deepcopy(obs)
        m["stores"][g["store"]]["records"] = r
        out.append(("correlated", f"{g['store']}: {g['detail']} changed with {g['total']} recomputed", m))
    if "return_code" in obs:
        m = copy.deepcopy(obs)
        m["return_code"] = (obs["return_code"] or 0) + 4
        out.append(("value", "return_code changed", m))
    m = copy.deepcopy(obs)
    m["abend"] = "S0C7" if obs.get("abend") is None else None
    out.append(("value", "abend changed", m))
    return out


def canary_sweep(samples: list[dict], comparator: str | None, unit: str, correlated: list[dict], tmp: Path) -> dict:
    caught, missed = [], []
    classes_applied = set()
    for obs in samples:
        base = run_comparator(comparator, obs, obs, unit, tmp)
        if not base["equal"]:
            raise Bad("the comparator reports a difference between identical observations")
        for cls, desc, mutated in canary_mutations(obs, correlated):
            classes_applied.add(cls)
            try:
                r = run_comparator(comparator, obs, mutated, unit, tmp)
            except Bad as e:  # a comparator that cannot read a canary cannot be trusted with real output
                missed.append(f"{cls}: {desc} (comparator failed: {str(e)[:80]})")
                continue
            (missed if r["equal"] else caught).append(f"{cls}: {desc}")
    gaps = []
    if "structural" not in classes_applied or not any("reorder" in c for c in caught + missed):
        gaps.append("no sample store has two different records, so structural canaries could not all run")
    return {"trusted": not missed and not gaps, "caught": len(caught), "missed": missed, "gaps": gaps,
            "classes": sorted(classes_applied)}


# ---------------------------------------------------------------------------
# Obligations (§6.7)
# ---------------------------------------------------------------------------


def load_obligations(ws: WS) -> list[dict]:
    if not ws.obligations.is_dir():
        return []
    return [load(p) for p in sorted(ws.obligations.glob("OBL-*.json"))]


def all_runs(ws: WS):
    if not ws.evidence.is_dir():
        return
    for p in sorted(ws.evidence.glob("*/*/run.json")):
        yield load(p)


def _exercises(case_result: dict, run: dict, requirement: str) -> bool:
    kind, _, name = requirement.partition(":")
    if kind in ("hazard", "class", "rule"):
        return requirement in case_result["classes"] or (kind == "class" and name in case_result["classes"])
    if kind == "calendar":
        return name in run["coverage"]["calendar_events"]
    return requirement in case_result["classes"]


def discharge(ws: WS) -> list[dict]:
    """An obligation is discharged only by runs that exercised its requirement on its observables (Rule B)."""
    out = []
    runs = list(all_runs(ws))
    for ob in load_obligations(ws):
        hits, mismatches, by = 0, 0, set()
        for run in runs:
            for r in run["results"]:
                if not set(ob["observables"]) & set(r["compared"]):
                    continue
                if not _exercises(r, run, ob["requirement"]):
                    continue
                if r["pass"]:
                    hits += 1
                    by.add(run["run_id"])
                else:
                    mismatches += 1
        status = "discharged" if hits >= ob.get("min_count", 1) and mismatches == 0 else "open"
        ob = {**ob, "status": status, "exercised": hits, "mismatches": mismatches, "discharged_by": sorted(by) if status == "discharged" else []}
        dump(ws.obligations / f"{ob['id']}.json", ob)
        out.append(ob)
    return out


# ---------------------------------------------------------------------------
# Verdicts (§6.5)
# ---------------------------------------------------------------------------


def verdict(ws: WS, gate_unit: str, rung: str, key: str, requirements: dict, write_obligations: bool) -> dict:
    """PROVEN / PROVISIONAL / NOT_PROVEN / FLAKY from every run under the key. Reruns never clear a failure."""
    keydir = ws.evidence / key
    runs = [load(p) for p in sorted(keydir.glob("*/run.json"))] if keydir.is_dir() else []
    runs = [r for r in runs if r["gate_unit"] == gate_unit]
    if not runs:
        return {"verdict": "NOT_PROVEN", "reasons": ["no runs under the current key"], "gaps": []}
    signoffs = {}
    sd = ws.evidence / "signoffs"
    if sd.is_dir():
        for p in sd.glob("*.json"):
            s = load(p)
            signoffs[s["case"]] = s
    outcomes = {}
    for run in runs:
        for r in run["results"]:
            outcomes.setdefault(r["case"], []).append((r["pass"], run["environment"]))
    if sum(len(v) for v in outcomes.values()) == 0:
        return {"verdict": "NOT_PROVEN", "reasons": ["the runs executed zero cases"], "gaps": []}
    flaky, failed, infra = [], [], []
    for cid, res in outcomes.items():
        passes = {p for p, _ in res}
        if passes == {True, False}:
            s = signoffs.get(cid)
            envs_fail = {e for p, e in res if not p}
            envs_pass = {e for p, e in res if p}
            if s and s.get("signed_by") and envs_fail != envs_pass and len(envs_fail | envs_pass) >= 2:
                infra.append(cid)
                continue
            flaky.append(cid)
        elif passes == {False}:
            failed.append(cid)
    if flaky:
        return {"verdict": "FLAKY", "reasons": [f"{len(flaky)} case(s) both pass and fail under the same key"],
                "cases": len(flaky), "gaps": []}
    if failed:
        return {"verdict": "NOT_PROVEN", "reasons": [f"{len(failed)} case(s) fail under the current key"], "gaps": []}

    cov = {"observables": {}, "classes": {}, "hazards": {}, "calendar_events": set()}
    fresh_by_class = {}
    for run in runs:
        c = run["coverage"]
        for part in ("observables", "classes", "hazards"):
            for k, v in c[part].items():
                cov[part][k] = cov[part].get(k, 0) + v
        cov["calendar_events"] |= set(c["calendar_events"])
        for r in run["results"]:
            if r.get("fresh") and not r.get("property_only"):
                for cl in r["classes"]:
                    fresh_by_class[cl] = fresh_by_class.get(cl, 0) + 1
    gaps = []
    for oid in requirements.get("observables", []):
        if cov["observables"].get(oid, 0) < 1:
            gaps.append({"observables": [oid], "requirement": "class:any", "reason": f"observable {oid} was never compared"})
    for cl, n in requirements.get("classes", {}).items():
        if cov["classes"].get(cl, 0) < n:
            gaps.append({"observables": requirements.get("observables", []), "requirement": f"class:{cl}",
                         "reason": f"class {cl}: {cov['classes'].get(cl, 0)} of {n} inputs"})
    for cl in requirements.get("fresh_classes", []):
        if fresh_by_class.get(cl, 0) < 1:
            gaps.append({"observables": requirements.get("observables", []), "requirement": f"class:{cl}",
                         "reason": f"class {cl} had no fresh input compared against legacy"})
    for hz in requirements.get("hazards", []):
        if cov["hazards"].get(hz, 0) < 1:
            gaps.append({"observables": requirements.get("observables", []), "requirement": f"hazard:{hz}",
                         "reason": f"hazard {hz} was never reached"})
    for ev in requirements.get("calendar_events", []):
        if ev not in cov["calendar_events"]:
            gaps.append({"observables": requirements.get("observables", []), "requirement": f"calendar:{ev}",
                         "reason": f"calendar event {ev} not covered"})
    recorded = any(r["mode"] == "recorded" for r in runs)
    for cap in requirements.get("capped", []):  # reference fidelity (§6.8): differences from production
        gaps.append({"observables": cap["observables"], "requirement": f"hazard:{cap['hazard']}",
                     "reason": f"environment differs from production: {cap['hazard']}"})

    obligations = load_obligations(ws)

    def covered(g):
        return any(o["requirement"] == g["requirement"] and set(g["observables"]) <= set(o["observables"])
                   and o.get("accepted_by") for o in obligations)

    if write_obligations:
        for g in gaps:
            if not any(o["requirement"] == g["requirement"] and set(g["observables"]) <= set(o["observables"]) for o in obligations):
                oid = "OBL-" + sha(canon([gate_unit, g["requirement"], sorted(g["observables"])]))[:8]
                ob = {"id": oid, "observables": sorted(g["observables"]), "requirement": g["requirement"],
                      "min_count": 1, "reason": g["reason"], "created_by": f"{gate_unit} {rung}",
                      "accepted_by": None, "status": "open"}
                dump(ws.obligations / f"{oid}.json", ob)
                obligations.append(ob)
    unaccepted = [g for g in gaps if not covered(g)]
    base = {"runs": len(runs), "cases": len(outcomes), "infra_cleared": len(infra), "gaps": gaps}
    if unaccepted:
        return {**base, "verdict": "NOT_PROVEN", "reasons": [g["reason"] for g in unaccepted]}
    if gaps or recorded:
        why = ["recorded mode reaches PROVISIONAL at most"] if recorded and not gaps else []
        return {**base, "verdict": "PROVISIONAL", "reasons": why + [g["reason"] for g in gaps]}
    return {**base, "verdict": "PROVEN", "reasons": []}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command")
    ap.add_argument("sub", nargs="?")
    ap.add_argument("--ws", default=".")
    ap.add_argument("--system", required=True)
    ap.add_argument("--input")
    ap.add_argument("--expected")
    ap.add_argument("--classes", default="")
    ap.add_argument("--origin", default="characterization")
    ap.add_argument("--set", dest="set_name")
    ap.add_argument("--gate-unit")
    ap.add_argument("--mode")
    ap.add_argument("--pool", default="", help="comma-separated case ids, or @file with one per line")
    ap.add_argument("--required", help="JSON file: {class: description}")
    ap.add_argument("--generators", help="JSON file: {generator: definition}")
    ap.add_argument("--key")
    ap.add_argument("--legacy-dir")
    ap.add_argument("--modern-dir")
    ap.add_argument("--fresh", default="")
    ap.add_argument("--comparator")
    ap.add_argument("--normalizers", default="", help="comma-separated normalizer JSON files")
    ap.add_argument("--env", default="default")
    ap.add_argument("--rung")
    ap.add_argument("--legacy-root")
    ap.add_argument("--modern", default="", help="comma-separated modern files in the runtime closure")
    ap.add_argument("--comparators", default="")
    ap.add_argument("--packs", default="{}")
    ap.add_argument("--environment", default="{}")
    ap.add_argument("--file")
    ap.add_argument("--legacy-ids")
    ap.add_argument("--modern-ids")
    ap.add_argument("--samples", default="")
    ap.add_argument("--correlated", default="[]")
    ap.add_argument("--requirements")
    ap.add_argument("--write-obligations", action="store_true")
    ap.add_argument("--derived", default="")
    a = ap.parse_args(argv)
    ws = WS(a.ws, a.system)

    def ids(v):
        if v.startswith("@"):
            return [x.strip() for x in Path(v[1:]).read_text().split() if x.strip()]
        return [x for x in v.split(",") if x]

    try:
        if a.command == "case" and a.sub == "add":
            c = add_case(ws, load(a.input), ids(a.classes), a.origin, load(a.expected) if a.expected else None)
            out, ok = {"id": c["id"], "classes": c["classes"]}, True
        elif a.command == "set" and a.sub == "build":
            s = build_set(ws, a.set_name, a.gate_unit, a.mode, ids(a.pool), load(a.required) if a.required else {},
                          load(a.generators) if a.generators else {})
            out, ok = {"set": s["name"], "dev": len(s["dev"]), "sealed": len(s["sealed"]), "hash": set_hash(s)}, True
        elif a.command == "judge":
            out = judge(ws, a.set_name, a.key, Path(a.legacy_dir), Path(a.modern_dir), ids(a.fresh), a.comparator,
                        [load(p) for p in ids(a.normalizers)], a.env)
            ok = out["passed"] == out["total"]
        elif a.command == "key":
            out = evidence_key(ws, a.gate_unit, a.rung, Path(a.legacy_root), ids(a.modern), a.set_name,
                               ids(a.comparators), json.loads(a.packs), json.loads(a.environment))
            ok = True
        elif a.command == "normalizer":
            errs = check_normalizer(ws, load(a.file))
            out, ok = {"legal": not errs, "reasons": errs}, not errs
        elif a.command == "delta":
            errs = check_delta(ws, load(a.file), ids(a.legacy_ids), ids(a.modern_ids))
            out, ok = {"total": not errs, "reasons": errs}, not errs
        elif a.command == "canary":
            out = canary_sweep([load(p) for p in ids(a.samples)], a.comparator, a.gate_unit.split(":")[-1],
                               json.loads(a.correlated), ws.evidence / ".tmp")
            ok = out["trusted"]
        elif a.command == "verdict":
            out = verdict(ws, a.gate_unit, a.rung, a.key, load(a.requirements) if a.requirements else {}, a.write_obligations)
            ok = out["verdict"] in ("PROVEN", "PROVISIONAL")
        elif a.command == "obligations":
            obs = discharge(ws)
            out = {"open": [o["id"] for o in obs if o["status"] == "open"],
                   "discharged": [o["id"] for o in obs if o["status"] == "discharged"]}
            ok = not out["open"]
        elif a.command == "calendar":
            need = sorted(set(MINIMUM_WINDOW) | set(ids(a.derived)))
            seen = set()
            for run in all_runs(ws):
                if run["gate_unit"] == a.gate_unit:
                    seen |= set(run["coverage"]["calendar_events"])
            out = {"required": need, "covered": sorted(seen & set(need)), "missing": sorted(set(need) - seen)}
            ok = not out["missing"]
        else:
            raise Bad(f"unknown command {a.command} {a.sub or ''}".strip())
    except Bad as e:
        print(json.dumps({"error": str(e)}))
        return 2
    print(json.dumps(out, indent=2, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
