"""Probe 8: evidence ledger (§7) links evidence to (module, rung, commit, oracle version);
"A verdict citing a stale commit is invalid." Two readings of `commit` for a module, run on a real git repo:
  (a) module commit = last commit touching modernized/<module>/   (b) repo HEAD
A shared module (common) changes rounding; an unrelated module (cards) gets a doc-only commit.
"""
import json, shutil, subprocess, sys
from decimal import Decimal as D
from pathlib import Path

R = Path(sys.argv[0]).resolve().parent / "out" / "repo"
shutil.rmtree(R, ignore_errors=True); R.mkdir(parents=True)
def git(*a): return subprocess.run(["git", "-C", str(R), *a], check=True, capture_output=True,
                                   text=True).stdout.strip()
def write(p, s): (R / p).parent.mkdir(parents=True, exist_ok=True); (R / p).write_text(s)
git("init", "-q"); git("config", "user.email", "probe@x"); git("config", "user.name", "probe")
write("modernized/common/money.py",
      "from decimal import Decimal, ROUND_HALF_UP\n"
      "def round2(x): return x.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)\n")
write("modernized/accounts/interest.py",
      "from common.money import round2\n"
      "def accrue(bal, apr): return round2(bal * apr / 365)\n")
write("modernized/cards/README.md", "cards\n")
git("add", "-A"); git("commit", "-qm", "initial")

CASES = [("10.00", "0.1825", "0.01"), ("1000.00", "0.1825", "0.50"), ("30.00", "0.1825", "0.02")]
def run_v3():   # differential vs. legacy expected outputs, executed against the current tree
    code = ("import sys,json; sys.path.insert(0,'modernized'); from decimal import Decimal as D;"
            "from accounts.interest import accrue;"
            f"print(json.dumps([str(accrue(D(b),D(a)))==e for b,a,e in {CASES!r}]))")
    return all(json.loads(subprocess.run([sys.executable, "-I", "-c", code], cwd=R,
                                         capture_output=True, text=True, check=True).stdout))
mod_commit = lambda m: git("log", "-1", "--format=%H", "--", f"modernized/{m}")
ledger = [{"module": "accounts", "rung": "V3", "commit": mod_commit("accounts"),
           "head": git("rev-parse", "HEAD"), "oracle": "v1", "pass": run_v3()}]

def verdict(reading):
    e = ledger[-1]
    cur = mod_commit("accounts") if reading == "a" else git("rev-parse", "HEAD")
    key = "commit" if reading == "a" else "head"
    if e[key] != cur: return "NOT_PROVEN(stale evidence)"
    return "PROVEN" if e["pass"] else "NOT_PROVEN"

print("after V3 run          : (a)", verdict("a"), "| (b)", verdict("b"), "| V3 re-run passes:", run_v3())
write("modernized/common/money.py",
      "from decimal import Decimal, ROUND_HALF_EVEN\n"
      "def round2(x): return x.quantize(Decimal('0.01'), rounding=ROUND_HALF_EVEN)\n")
git("commit", "-qam", "common: banker's rounding")
print("after common/ change  : (a)", verdict("a"), "| (b)", verdict("b"), "| V3 re-run passes:", run_v3())
ledger.append(dict(ledger[-1], head=git("rev-parse", "HEAD"), commit=mod_commit("accounts"),
                   **{"pass": run_v3()}))
write("modernized/common/money.py",
      "from decimal import Decimal, ROUND_HALF_UP\n"
      "def round2(x): return x.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)\n")
git("commit", "-qam", "common: revert rounding")
ledger.append(dict(ledger[-1], head=git("rev-parse", "HEAD"), **{"pass": run_v3()}))
write("modernized/cards/README.md", "cards module\n")
git("commit", "-qam", "cards: docs only")
print("after cards/ doc edit : (a)", verdict("a"), "| (b)", verdict("b"), "| V3 re-run passes:", run_v3())
