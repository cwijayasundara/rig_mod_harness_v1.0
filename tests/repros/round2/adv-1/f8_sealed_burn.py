"""Sealed minimum + case burning on a recorded-only unit (PROPOSAL v0.2 §6.1, §5.3, §6.4, §6.5, §4.3, §5.1).

Followed:
  §6.1 case id = sha256(canonical input); sealed "must hold at least 20 cases, or 25% of the pool, whichever is
       larger. A pool too small ... gets topped up from the generators before the unit starts."
       Case.expected = "legacy observations".
  §5.3 rule 2: a failed sealed case moves to dev and is replaced "with a new sealed case drawn from the same
       generator. A case the worker has seen is never used to grade again."
  §6.4 gates run at the gate unit (job:INTJOB), so one case = one night's job input (all input files).
  §6.5 "Recorded production I/O only -> PROVISIONAL"; legacy cannot execute, so a generator can produce an
       input but not its expected legacy observations.
  §4.3 "A unit with a ROUNDED COMPUTE cannot pass without tie inputs."   §5.1 budget wallclock 45m, attempts 3.
"""
import hashlib, math

pool = [hashlib.sha256(f"INTJOB night {n}".encode()).hexdigest() for n in range(120)]  # 120 recorded nights
def minimum(p): return max(20, math.ceil(0.25 * p))
sealed = sorted(pool)[:minimum(len(pool))]; dev = sorted(pool)[minimum(len(pool)):]
print(f"pool {len(pool)} recorded nights -> sealed {len(sealed)} (min {minimum(len(pool))}), dev {len(dev)}")

def replacement(origin):           # "drawn from the same generator"
    return None if origin == "recorded" else "new case"   # recorder yields one new case per production night

failed_per_attempt = [9, 4]        # worker fails some sealed nights on attempts 1 and 2
day = 0
for a, f in enumerate(failed_per_attempt, 1):
    n0 = len(sealed)
    burned, sealed = sealed[:f], sealed[f:]; dev += burned
    rep = [replacement("recorded") for _ in burned]
    after = len(sealed); need = minimum(len(dev) + len(sealed))
    wait = 0
    while len(sealed) < minimum(len(dev) + len(sealed)):
        wait += 1; sealed.append(f"night+{day+wait}")          # wait for production to record another night
    day += wait
    print(f"attempt {a}: sealed {n0-f} of {n0}; {f} burned to dev, replacements available {len(rep)-rep.count(None)}/{f}; "
          f"sealed {after} < min {need} -> next judge after {wait} production nights (WU wallclock 45m)")

hazard_tie_cases_with_expected = 0   # generator can make tie inputs; no legacy run -> no expected observations
print(f"§4.3 ROUNDED hazard: tie inputs with legacy expected = {hazard_tie_cases_with_expected} -> V4 "
      f"{'cannot pass' if hazard_tie_cases_with_expected == 0 else 'ok'} -> verdict NOT_PROVEN; §6.5 table promises PROVISIONAL")
