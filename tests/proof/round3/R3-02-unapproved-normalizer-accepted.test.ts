/**
 * R3-02: `judge --normalizers` applies any normalizer file as given. Unlike deltas (approvedDeltas), it never checks
 * `approved_by` or the consumer rules (checkNormalizer), so an unapproved field mask hides a real difference.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

test('judge refuses a normalizer nobody approved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-02-'))
  const log = console.log
  try {
    const ws = new P.WS(dir, 'sys')
    const L = join(dir, 'L'), M = join(dir, 'M')
    mkdirSync(L); mkdirSync(M)
    const ids = Array.from({ length: 20 }, (_, n) => P.addCase(ws, { records: { IN: [{ n: String(n) }] }, params: {}, clock: null, stores: {}, session: null }, ['random'], 'random', null)['id'] as string)
    P.buildSet(ws, 'S', 'job:INTJOB', 'executable', ids, { random: 'any' }, {})
    for (const id of ids) {
      P.dump(join(L, `${id}.json`), { return_code: 0, abend: null, stores: { ACCTFILE: { records: [{ ID: '1', BAL: '100.00' }] } } })
      P.dump(join(M, `${id}.json`), { return_code: 0, abend: null, stores: { ACCTFILE: { records: [{ ID: '1', BAL: '999.99' }] } } })
    }
    const norm = join(dir, 'NORM-1.json')
    P.dump(norm, { id: 'NORM-1', observable: 'INTJOB/ACCTFILE.field:BAL', erases: 'field', store: 'ACCTFILE', field: 'BAL', approved_by: null })
    console.log = () => {}
    const code = P.main(['judge', '--ws', dir, '--system', 'sys', '--set', 'S', '--key', 'K1', '--legacy-dir', L, '--modern-dir', M, '--normalizers', norm])
    console.log = log
    assert.notEqual(code, 0, 'an unapproved normalizer masked BAL 100.00 vs 999.99 and the judge passed every case')
  } finally { console.log = log; rmSync(dir, { recursive: true, force: true }) }
})
