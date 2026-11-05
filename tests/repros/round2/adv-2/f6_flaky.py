# §6.5 line 363 (pure function of evidence under current key; other keys ignored), line 364 (runs under same key
# disagree -> FLAKY; blocks merge until human quarantine or 5 consecutive reruns pass), line 541 (evidence immutable).
import random
def verdict_pure(runs):                    # literal reading of line 363 + 364 over all evidence under the key
    s = set(runs)
    return "PROVEN" if s == {"pass"} else "NOT_PROVEN" if s == {"fail"} else "FLAKY"
def verdict_with_streak(runs):             # line 364's escape: 5 consecutive passes clears FLAKY
    v = verdict_pure(runs)
    return "PROVEN" if v == "FLAKY" and runs[-5:] == ["pass"] * 5 else v
ev = ["pass", "fail"] + ["pass"] * 5
print("evidence under key:", ev, "| pure verdict:", verdict_pure(ev), "| with 5-pass rule:", verdict_with_streak(ev))
# Real intermittent bug: a race on a shared TCATBALF update loses an update in p of runs.
rnd = random.Random(1)
for p in (0.05, 0.10, 0.30):
    proven, reruns = 0, []
    for _ in range(10000):
        runs = ["pass", "fail"]            # bug already observed once -> FLAKY
        while verdict_with_streak(runs) == "FLAKY" and len(runs) < 22:   # budget: 20 reruns
            runs.append("fail" if rnd.random() < p else "pass")
        if verdict_with_streak(runs) == "PROVEN": proven += 1; reruns.append(len(runs) - 2)
    reruns.sort()
    print(f"real bug failing {p:.0%} of runs, already seen failing: cleared to PROVEN within 20 reruns in {proven/100:.1f}% (median {reruns[len(reruns)//2]} reruns)")
