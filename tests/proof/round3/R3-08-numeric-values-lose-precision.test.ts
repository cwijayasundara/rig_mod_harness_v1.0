/**
 * R3-08: observation values must be strings (references/proof.md), but nothing enforces it. load() parses JSON numbers
 * as doubles and exactCompare() compares canon() of the parsed value, so a runner that writes amounts as JSON numbers
 * gets differences hidden: 1.10 vs 1.1 (scale), and 9007199254740993 vs 9007199254740992 (precision) compare equal.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

test('numeric field values that differ in the file never compare equal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-08-'))
  try {
    const l = join(dir, 'l.json'), m = join(dir, 'm.json')
    writeFileSync(l, '{"return_code":0,"abend":null,"stores":{"ACCT":{"records":[{"ID":9007199254740993,"BAL":1.10}]}}}')
    writeFileSync(m, '{"return_code":0,"abend":null,"stores":{"ACCT":{"records":[{"ID":9007199254740992,"BAL":1.1}]}}}')
    let r: P.Comparison
    try { r = P.exactCompare(P.load(l), P.load(m), 'INTJOB') } catch { return } // refusing non-string values is fine
    assert.equal(r.equal, false, `ID and BAL differ in the observation files, comparator says equal (diffs: ${JSON.stringify(r.diffs)})`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
