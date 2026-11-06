/**
 * R3-07: runComparator() takes `equal: Boolean(r.equal)` and ignores the comparator's exit status. A comparator that
 * prints `"equal": "false"` (a string, e.g. from a shell `echo`) is read as equal, and one that crashes after printing a
 * partial `{"equal": true, ...}` is read as a pass.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

const legacy = { return_code: 0, abend: null }
const modern = { return_code: 8, abend: null }

function withComparator(body: string, fn: (spec: string, tmp: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-07-'))
  try {
    const f = join(dir, 'cmp.mjs')
    writeFileSync(f, body)
    fn(`${process.execPath} ${f}`, join(dir, 'tmp'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('a comparator saying "equal": "false" is not a pass', () => {
  withComparator(`console.log(JSON.stringify({ equal: 'false', compared: ['INTJOB.return_code'] }))`, (spec, tmp) => {
    let r: P.Comparison
    try { r = P.runComparator(spec, legacy, modern, 'INTJOB', tmp) } catch { return } // refusing a non-boolean is fine
    assert.equal(r.equal, false, 'the string "false" was read as equal')
  })
})

test('a comparator that exits non-zero is not a pass', () => {
  withComparator(`console.log(JSON.stringify({ equal: true, compared: ['INTJOB.return_code'] })); process.exit(3)`, (spec, tmp) => {
    let r: P.Comparison
    try { r = P.runComparator(spec, legacy, modern, 'INTJOB', tmp) } catch { return }
    assert.equal(r.equal, false, 'a comparator that failed (exit 3) was read as equal')
  })
})
