/**
 * R3-01: in executable mode, a case whose legacy observation file is missing is judged "property only" and passes.
 * judge() falls back to `c.expected ?? null` and treats null as "recorded mode, generated input" without checking the
 * set's mode, so dropping the legacy observations of the cases that fail turns NOT_PROVEN into PROVEN.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

test('executable mode: a missing legacy observation is not a pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-01-'))
  try {
    const ws = new P.WS(dir, 'sys')
    const L = join(dir, 'L'), M = join(dir, 'M')
    mkdirSync(L); mkdirSync(M)
    const ids = Array.from({ length: 24 }, (_, n) => P.addCase(ws, { records: { IN: [{ n: String(n) }] }, params: {}, clock: null, stores: {}, session: null }, ['random'], 'random', null)['id'] as string)
    P.buildSet(ws, 'S', 'job:INTJOB', 'executable', ids, { random: 'any' }, { random: 'gen' })
    const legacyObs = { return_code: 0, abend: null, stores: { OUT: { records: [{ AMT: '1.00' }] } } }
    const wrongObs = { return_code: 0, abend: null, stores: { OUT: { records: [{ AMT: '9.99' }] } } }
    // One case has both sides. The other 23 would differ from legacy; their legacy files are simply not there.
    P.dump(join(L, `${ids[0]}.json`), legacyObs)
    P.dump(join(M, `${ids[0]}.json`), legacyObs)
    for (const id of ids.slice(1)) P.dump(join(M, `${id}.json`), wrongObs)

    let threw = false
    try { P.judge(ws, 'S', 'K1', L, M, [], undefined, [], 'ref') } catch { threw = true }
    if (!threw) {
      const v = P.verdict(ws, 'job:INTJOB', 'V3', 'K1', { observables: ['INTJOB.return_code', 'INTJOB/OUT.field:AMT'] }, false)
      assert.notEqual(v['verdict'], 'PROVEN', '23 sealed/dev cases were never compared against legacy, yet the verdict is PROVEN')
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
