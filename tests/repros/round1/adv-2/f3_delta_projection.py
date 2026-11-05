# DELTA-007 comparator as specified: project print133 and JSON into Statement{account, lines[], totals}
import json
from decimal import Decimal as D
def print133_to_canon(lines):
    acct=None; out=[]; tot=None
    for l in lines:
        cc, body = l[0], l[1:]
        if body.startswith('ACCT '): acct = body[5:16].strip()
        elif body.startswith('TXN '): out.append((body[4:14].strip(), D(body[40:54].strip())))
        elif body.startswith('TOTAL'): tot = D(body[40:54].strip())
        # 'MIN PAYMENT DUE' and 'PAY BY' lines are not part of Statement{account,lines[],totals}
    return {'account':acct,'lines':out,'totals':tot}
def json_to_canon(js):
    j=json.loads(js)
    return {'account':j['accountId'],'lines':[(t['date'],D(t['amount'])) for t in j['transactions']],'totals':D(j['total'])}
def rec(s): return (' '+s).ljust(133)
legacy = [rec('ACCT 00000012345'),
          rec('TXN 2026-10-03'.ljust(39)+'        120.50'),
          rec('TXN 2026-10-17'.ljust(39)+'         79.50'),
          rec('TOTAL'.ljust(39)+'        200.00'),
          rec('MIN PAYMENT DUE'.ljust(39)+'         25.00'),
          rec('PAY BY 2026-11-25')]
modern = json.dumps({'accountId':'00000012345',
  'transactions':[{'date':'2026-10-03','amount':'120.50'},{'date':'2026-10-17','amount':'79.50'}],
  'total':'200.00','minimumPaymentDue':'2.00','payBy':'2026-12-25'})   # BUGS: min-pay 10x low, due date +1 month
a, b = print133_to_canon(legacy), json_to_canon(modern)
print('canonical equal:', a==b)
print('DELTA-007 comparator verdict:', 'PASS' if a==b else 'FAIL')
print('legacy min-pay/pay-by: 25.00 / 2026-11-25   modern:', json.loads(modern)['minimumPaymentDue'], '/', json.loads(modern)['payBy'])
