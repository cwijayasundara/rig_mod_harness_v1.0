/**
 * R4-01 (PROPOSAL §14, M3): "A REDEFINES mapping to a sealed type cannot express writing through one view and reading
 * through another." The cobol-to-java bridge maps REDEFINES to one byte area with typed views, and its hazard catalog
 * has a `redefines` generator. This pins what the proof core must do with it: a port that keeps the views apart (the
 * sealed-type mistake) reads a stale value through the second view, and that case fails; a run that never reaches the
 * hazard leaves it as a gap.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

const GU = 'job:CUSTUPD'
function ws() {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r4-01-'))
  const w = new P.WS(dir, 'sys')
  mkdirSync(w.analysis, { recursive: true })
  writeFileSync(join(w.analysis, 'graph.json'), JSON.stringify({ nodes: [{ id: 'job:CUSTUPD', loc: 'CUSTUPD.cbl:1' }], edges: [] }))
  mkdirSync(join(dir, 'legacy')); writeFileSync(join(dir, 'legacy', 'CUSTUPD.cbl'), 'PROCEDURE DIVISION.')
  mkdirSync(join(dir, 'modern')); writeFileSync(join(dir, 'modern', 'Custupd.java'), 'class Custupd {}')
  return { dir, w }
}
const inp = (n: number) => ({ records: { CUST: [{ id: String(n) }] }, params: {}, clock: null, stores: {}, session: null })
// CUST-REC written through CUST-NUM-VIEW (PIC 9(4) = 0042), read back through CUST-TXT-VIEW (PIC X(4)).
const rec = (txt: string) => ({ return_code: 0, abend: null, stores: { CUST: { records: [{ 'CUST-NUM-VIEW': '0042', 'CUST-TXT-VIEW': txt }] } } })

function judge(dir: string, w: P.WS, staleOnModern: boolean, withHazardCase: boolean) {
  const pool = Array.from({ length: 20 }, (_, i) => P.addCase(w, inp(i), ['random'], 'c', null)['id'] as string)
  const hz = withHazardCase ? [P.addCase(w, inp(100), ['hazard:H-RD1'], 'hazard', null)['id'] as string] : []
  P.buildSet(w, 'S', GU, 'executable', [...pool, ...hz], { random: 'r', ...(withHazardCase ? { 'hazard:H-RD1': 'write one view, read the other' } : {}) }, {})
  const L = join(dir, 'l'), M = join(dir, 'm')
  mkdirSync(L); mkdirSync(M)
  for (const id of [...pool, ...hz]) {
    writeFileSync(join(L, `${id}.json`), JSON.stringify(rec('0042')))
    writeFileSync(join(M, `${id}.json`), JSON.stringify(rec(hz.includes(id) && staleOnModern ? '    ' : '0042')))
  }
  const key = P.evidenceKey(w, GU, 'V3', join(dir, 'legacy'), ['modern/Custupd.java'], 'S', [], {}, {})['key'] as string
  return { key, r: P.judge(w, 'S', key, L, M, [], undefined, [], 'env') }
}

test('a port that keeps the REDEFINES views apart reads a stale value through the second view: the case fails', () => {
  const { dir, w } = ws()
  try {
    const { key, r } = judge(dir, w, true, true)
    assert.equal(r['total'] - r['passed'], 1)
    assert.equal(P.verdict(w, GU, 'V3', key, { hazards: ['H-RD1'] }, false)['verdict'], 'NOT_PROVEN')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a run that never wrote through one view and read through the other leaves the hazard as a gap', () => {
  const { dir, w } = ws()
  try {
    const { key } = judge(dir, w, false, false)
    const v = P.verdict(w, GU, 'V3', key, { hazards: ['H-RD1'] }, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((x: string) => /hazard H-RD1 was never reached/.test(x)))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
