/**
 * R3-03: judge() adds calendar events from every case's clock label (rig_proof.ts judge, `coverage.calendar_events.push`),
 * whether or not either runner applied that clock. shadow() was fixed in M6 to require `clock_applied` on both sides
 * (Rule B: a clock that is only a label exercised no date); the judge path still counts the label.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

test('a judged case whose clock was not applied covers no calendar event', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-03-'))
  try {
    const ws = new P.WS(dir, 'sys')
    const L = join(dir, 'L'), M = join(dir, 'M')
    mkdirSync(L); mkdirSync(M)
    const ids = Array.from({ length: 20 }, (_, n) => P.addCase(ws, { records: { IN: [{ n: String(n) }] }, params: {}, clock: '2026-12-31T23:00:00', stores: {}, session: null }, ['random'], 'random', null)['id'] as string)
    P.buildSet(ws, 'S', 'job:INTJOB', 'executable', ids, { random: 'any' }, {})
    // Neither runner says it applied the clock: both ran on the host date.
    for (const id of ids) for (const d of [L, M]) P.dump(join(d, `${id}.json`), { return_code: 0, abend: null, messages: ['ok'] })
    P.judge(ws, 'S', 'K1', L, M, [], undefined, [], 'ref')
    const v = P.verdict(ws, 'job:INTJOB', 'V3', 'K1', { observables: ['INTJOB.return_code'], calendar_events: ['quarter_end', 'year_end'] }, false)
    assert.notEqual(v['verdict'], 'PROVEN', 'quarter_end and year_end counted as covered from a clock nobody applied')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
