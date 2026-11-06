/**
 * R3-04: discharge() checks `calendar:<event>` against the run-level `coverage.calendar_events` (exercises()), not the
 * result's own case. A run where case A spans quarter_end without comparing the obligation's observable, and case B
 * compares the observable on an ordinary day, discharges "calendar:quarter_end on that observable".
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

test('a calendar obligation is discharged only by a case that spanned the event and compared the observable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-04-'))
  try {
    const ws = new P.WS(dir, 'sys')
    const T = join(dir, 't'), L = join(dir, 'l'), M = join(dir, 'm')
    for (const d of [T, L, M]) mkdirSync(d)
    const item = (name: string, clock: string, o: object) => {
      writeFileSync(join(T, name), JSON.stringify({ input: { records: {}, params: {}, clock, stores: {}, session: null } }))
      for (const d of [L, M]) writeFileSync(join(d, name), JSON.stringify({ ...o, clock_applied: clock }))
    }
    // Quarter end: the job wrote no ACCTFILE (an early exit), so ACCTFILE.field:BAL was not compared.
    item('a.json', '2026-12-31T02:00:00Z', { return_code: 0, abend: null })
    // An ordinary Monday: BAL compared.
    item('b.json', '2026-11-02T02:00:00Z', { return_code: 0, abend: null, stores: { ACCTFILE: { records: [{ BAL: '1.00' }] } } })
    P.shadow(ws, 'job:INTJOB', 'K10', T, L, M, undefined, [], 'prod', 'shadow')
    P.dump(join(ws.obligations, 'OBL-q.json'), { id: 'OBL-q', observables: ['INTJOB/ACCTFILE.field:BAL'], requirement: 'calendar:quarter_end', min_count: 1, accepted_by: 'owner', status: 'open' })
    const ob = P.discharge(ws).find((o) => o['id'] === 'OBL-q')!
    assert.equal(ob['status'], 'open', 'BAL was never compared on a quarter-end date, yet the obligation is discharged')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
