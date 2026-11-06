/**
 * R4-03 (PROPOSAL §14, M2): "Near-duplicate recordings that differ only in masked fields could defeat deduplication."
 * Cases are content-addressed by their canonical input. Two recorded traffic items that differ only in a field the
 * masking replaced become one case id. When the masked field changed the output, the legacy outputs of that one "case"
 * differ, which is impossible for one input: the recorded input is incomplete. Today shadow records both results under
 * one id and the verdict calls the case FLAKY, which hides a real failure of a distinct production input; case add
 * refuses with a message that does not say why.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

const GU = 'job:STMT'
// Two customers; the account number is masked to the same token, but the statement differs by customer.
const masked = { records: { CUST: [{ 'ACCT-NO': '<masked>', NAME: 'X' }] }, params: {}, clock: null, stores: {}, session: null }
const out = (line: string, ms = 5) => ({ return_code: 0, abend: null, messages: [line], elapsed_ms: ms })

function shadowRun() {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r4-03-'))
  const w = new P.WS(dir, 'sys')
  const T = join(dir, 't'), L = join(dir, 'l'), M = join(dir, 'm')
  for (const d of [T, L, M]) mkdirSync(d)
  for (const [name, legacy, modern] of [['a.json', 'STATEMENT 1001', 'STATEMENT 1001'], ['b.json', 'STATEMENT 2002', 'STATEMENT 1001']]) {
    writeFileSync(join(T, name), JSON.stringify({ input: masked }))
    writeFileSync(join(L, name), JSON.stringify(out(legacy, 5)))
    writeFileSync(join(M, name), JSON.stringify(out(modern, 9)))
  }
  P.shadow(w, GU, 'K10', T, L, M, undefined, [], 'shadow-env', 'shadow')
  return { dir, w }
}

test('two masked recordings with different legacy outputs are named as an incomplete input, not called FLAKY', () => {
  const { dir, w } = shadowRun()
  try {
    const run = [...P.allRuns(w)][0]!
    assert.equal(run['coverage']['input_collisions'].length, 1)
    const v = P.verdict(w, GU, 'V10', 'K10', {}, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((x: string) => /same case id but different legacy outputs/.test(x)), v['reasons'].join('; '))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('equal legacy outputs (elapsed time aside) are no collision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r4-03b-'))
  try {
    const w = new P.WS(dir, 'sys')
    const T = join(dir, 't'), L = join(dir, 'l'), M = join(dir, 'm')
    for (const d of [T, L, M]) mkdirSync(d)
    for (const [name, ms] of [['a.json', 5], ['b.json', 7]] as const) {
      writeFileSync(join(T, name), JSON.stringify({ input: masked }))
      writeFileSync(join(L, name), JSON.stringify(out('STATEMENT', ms)))
      writeFileSync(join(M, name), JSON.stringify(out('STATEMENT', ms)))
    }
    P.shadow(w, GU, 'K10', T, L, M, undefined, [], 'shadow-env', 'shadow')
    assert.deepEqual([...P.allRuns(w)][0]!['coverage']['input_collisions'], [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('case add says why two recordings with one masked input and different outputs cannot both be cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r4-03c-'))
  try {
    const w = new P.WS(dir, 'sys')
    P.addCase(w, masked, ['recorded'], 'recording', out('STATEMENT 1001'))
    assert.throws(() => P.addCase(w, masked, ['recorded'], 'recording', out('STATEMENT 2002')), /incomplete.*mask/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('shadow.md requires masking that keeps distinct values distinct', () => {
  const t = readFileSync(new URL('../../../plugins/rig/commands/shadow.md', import.meta.url), 'utf8')
  assert.match(t, /equal values give equal tokens and different values different tokens/)
})
