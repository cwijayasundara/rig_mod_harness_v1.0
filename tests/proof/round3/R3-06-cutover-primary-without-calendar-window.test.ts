/**
 * R3-06: cutover() promises that primary needs "the V10 verdict ... (that includes the calendar minimum window)", but it
 * passes the caller's requirements straight to verdict(), which checks calendar events only if the requirements list
 * them. Requirements without `calendar_events` let one day of shadow traffic reach primary and decommission.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

test('primary is not allowed after one Monday of shadow traffic', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-06-'))
  try {
    const ws = new P.WS(dir, 'cd')
    const T = join(dir, 't'), L = join(dir, 'l'), M = join(dir, 'm')
    for (const d of [T, L, M]) mkdirSync(d)
    const clock = '2026-11-02T02:00:00Z'
    writeFileSync(join(T, 'a.json'), JSON.stringify({ input: { records: {}, params: {}, clock, stores: {}, session: null } }))
    for (const d of [L, M]) writeFileSync(join(d, 'a.json'), JSON.stringify({ return_code: 0, abend: null, messages: ['A'], clock_applied: clock }))
    P.shadow(ws, 'job:READCUST', 'K10', T, L, M, undefined, [], 'prod', 'shadow')
    mkdirSync(join(dir, 'cutover', 'cd'), { recursive: true })
    writeFileSync(join(dir, 'cutover', 'cd', 'job_READCUST.json'), JSON.stringify({ stages: ['shadow', 'canary', 'primary'].map((stage) => ({ stage, go_by: 'owner', go_on: '2026-11-06' })) }))
    const c = P.cutover(ws, 'job:READCUST', 'primary', 'K10', { observables: ['READCUST.message', 'READCUST.return_code'] })
    assert.equal(c['allowed'], false, `primary allowed with only ${P.calendarEvents(clock).join(',')} covered; minimum window is ${P.MINIMUM_WINDOW.join(',')}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
