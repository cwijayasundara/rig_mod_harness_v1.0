# JCL: STEP1 SORT TXNS BY ACCT-ID (EBCDIC collation: letters < digits)
#      STEP2 BALANCED-LINE MATCH against MASTER (master sorted in EBCDIC, legacy-owned file)
# Phase C gate is per program (V3 with 'record order' normalizer; recorded legacy inputs per step).
def ebcdic_key(s): return s.encode('cp037')
def step1_legacy(txns): return sorted(txns, key=lambda t: ebcdic_key(t[0]))
def step1_modern(txns): return sorted(txns, key=lambda t: t[0])          # Java String.compareTo / ASCII
def step2_match(master, txns):                                            # classic COBOL match-merge
    i=j=0; posted=[]; unmatched=[]
    while j < len(txns):
        if i >= len(master): unmatched.append(txns[j][0]); j+=1; continue
        m, t = ebcdic_key(master[i]), ebcdic_key(txns[j][0])
        if m == t: posted.append(txns[j]); j+=1
        elif m < t: i+=1
        else: unmatched.append(txns[j][0]); j+=1
    return posted, unmatched
master = sorted(['AB100','CD200','1A300','9Z400'], key=ebcdic_key)
txns = [('9Z400',10),('AB100',5),('1A300',7),('CD200',3)]
norm = lambda recs: sorted(recs)                                          # declared 'record order' normalizer
print('V3 STEP1 (order-normalized):', 'PASS' if norm(step1_legacy(txns))==norm(step1_modern(txns)) else 'FAIL')
rec_in = step1_legacy(txns)                                               # recorded legacy input deck for STEP2
print('V3 STEP2 (recorded input):  ', 'PASS' if step2_match(master,rec_in)==step2_match(master,rec_in) else 'FAIL')
lp,lu = step2_match(master, step1_legacy(txns)); mp,mu = step2_match(master, step1_modern(txns))
print('legacy job: posted', len(lp), 'unmatched', lu)
print('modern job: posted', len(mp), 'unmatched', mu)
