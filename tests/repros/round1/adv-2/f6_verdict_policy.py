# Verdict engine encoding §3.3 policies + 'legacy can't run' caps + §2 rung applicability + §2 DAG.
import datetime as dt, calendar
APPLIES = {'V0':'all','V1':'all','V2':'TRU','V3':'TUR','V4':'TRU','V5':'all','V6':'TRI',
           'V7':'X','V8':'RE','V9':'all','V10':'E'}
CAP = {'gnucobol':'PROVEN','lpar':'PROVEN','logs_only':'PARTLY_PROVEN','nothing':'PARTLY_PROVEN'}
DAG = ['T','R','X','E']                     # E may start only after upstream steps are gated
def rung_verdict(rung, env):
    if rung in ('V2','V3','V4'): return CAP[env]        # execution-dependent rungs capped
    return 'PROVEN'
def gate(step, env):
    if step == 'T': return all(rung_verdict(f'V{i}',env)=='PROVEN' for i in range(7))
    return True
for env in CAP:
    reached=[]
    for s in DAG:
        if not gate(s, env): break
        reached.append(s)
    v10_reachable = 'E' in reached
    print(f"env={env:9s} T-gate={'PASS' if gate('T',env) else 'BLOCK'} steps reached={reached} V10 reachable={v10_reachable}")
# E policy: 'V7–V10 PROVEN for 10 consecutive business days' vs Phase F 'including month-end'
d=dt.date(2026,11,9); days=[]
while len(days)<10:
    if d.weekday()<5: days.append(d)
    d+=dt.timedelta(1)
month_end = any(x.day==calendar.monthrange(x.year,x.month)[1] for x in days)
print('parallel-run days', days[0], '..', days[-1], 'policy verdict: PROVEN', '| month-end covered:', month_end)
