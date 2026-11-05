"""I. The generalisation check (§5.3 rule 4) with the default bound of 0 rejects
honest code whose dev set holds one bad recorded case, and cannot produce the
document's own example output.

Built from:
  - Line 202: "A unit passes only when its pass rate on fresh inputs matches
    its pass rate on the dev set, within the declared bound, which defaults to 0."
  - Line 199: example judge output "sealed 41 of 44, fresh 4,988 of 5,000,
    generalisation PASS".
  - Line 186: self-check runs the dev oracle, so a worker iterates to green on dev.
"""
from fractions import Fraction as F

def generalisation(dev_pass, dev_n, fresh_pass, fresh_n, bound=F(0)):
    return abs(F(dev_pass, dev_n) - F(fresh_pass, fresh_n)) <= bound

# 1. Honest, fully correct port. One of 100 recorded dev cases was captured
#    while production had a hot-fix in flight, so its `expected` is wrong.
print("honest port, dev 99/100 (one bad recording), fresh 5000/5000:",
      "PASS" if generalisation(99, 100, 5000, 5000) else "FAIL  (rejected for being better on fresh than on dev)")

# 2. The document's own example (line 199): fresh 4,988 of 5,000. Which dev set
#    sizes could make "generalisation PASS" true with bound 0?
target = F(4988, 5000)
sizes = [n for n in range(1, 5001) if (target * n).denominator == 1]
print("dev sizes that can match fresh 4988/5000 exactly:", sizes[:4], "...")
print("example 'fresh 4,988 of 5,000, generalisation PASS' with a 44- or 100-case dev set:",
      any(generalisation(k, 100, 4988, 5000) for k in range(101)))

# 3. Worker iterates to dev 100% (line 186). Then the check reduces to fresh == 100%.
for fresh_pass in (5000, 4999):
    print(f"dev 100/100, fresh {fresh_pass}/5000: generalisation",
          "PASS" if generalisation(100, 100, fresh_pass, 5000) else "FAIL",
          "| fresh rung alone:", "PASS" if fresh_pass == 5000 else "FAIL",
          "-> the check never changes a verdict once dev is green")
