/**
 * R4-02 (PROPOSAL §14, M6): "CICS SYNCPOINT scope split across two services loses atomicity, and shadow runs do not
 * exercise partial failure." Replayed traffic rarely holds a partial failure, so the only thing that makes anyone
 * inject one is the hazard being required. Today the requirements file is the only source of required hazards, so a
 * hazard in hazards.json that the file leaves out (here a SYNCPOINT unit of work) is never asked for, and the V10 verdict
 * and cutover to primary go ahead on atomicity nobody tested.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

const GU = 'tx:CPAY'
const OBS = ['CPAY/ACCTDATA.store_write', 'CPAY/TRANSACT.store_write', 'CPAY.return_code']

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r4-02-'))
  const w = new P.WS(dir, 'sys')
  mkdirSync(w.analysis, { recursive: true })
  writeFileSync(join(w.analysis, 'graph.json'), JSON.stringify({ nodes: [
    { id: 'transaction:CPAY', loc: 'app/cbl/COBIL00C.cbl:1' }, { id: 'program:OTHER', loc: 'app/cbl/OTHER.cbl:1' }], edges: [] }))
  writeFileSync(join(w.analysis, 'hazards.json'), JSON.stringify({ hazards: [
    { id: 'H-SP1', hazard: 'syncpoint', loc: 'app/cbl/COBIL00C.cbl:210', text: 'EXEC CICS SYNCPOINT END-EXEC',
      why: 'ACCTDATA and TRANSACT are written in one unit of work; an abend between them rolls both back', observables: OBS.slice(0, 2) },
    { id: 'H-ELSEWHERE', hazard: 'truncation', loc: 'app/cbl/OTHER.cbl:9', text: 'COMPUTE X = Y', why: 'not in this unit', observables: [] }] }))
  // Replayed traffic: every item an ordinary, successful payment; all match.
  const T = join(dir, 't'), L = join(dir, 'l'), M = join(dir, 'm')
  for (const d of [T, L, M]) mkdirSync(d)
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-09-30', '2026-10-31', '2027-02-28', '2026-12-31']
  days.forEach((d, i) => {
    const clock = `${d}T10:00:00Z`
    writeFileSync(join(T, `${i}.json`), JSON.stringify({ input: { records: { PAY: [{ amt: String(i) }] }, params: {}, clock, stores: {}, session: null } }))
    const o = { return_code: 0, abend: null, clock_applied: clock, stores: { ACCTDATA: { records: [{ bal: '1' }] }, TRANSACT: { records: [{ amt: String(i) }] } } }
    writeFileSync(join(L, `${i}.json`), JSON.stringify(o)); writeFileSync(join(M, `${i}.json`), JSON.stringify(o))
  })
  P.shadow(w, GU, 'K10', T, L, M, undefined, [], 'shadow-env', 'shadow')
  mkdirSync(join(dir, 'cutover', 'sys'), { recursive: true })
  writeFileSync(join(dir, 'cutover', 'sys', 'tx_CPAY.json'), JSON.stringify({ stages: ['shadow', 'canary', 'primary'].map((s) => ({ stage: s, go_by: 'owner', go_on: '2026-11-06' })) }))
  return { dir, w }
}

test('a SYNCPOINT hazard in the unit\'s closure is required even when the requirements file leaves it out', () => {
  const { dir, w } = setup()
  try {
    const v = P.verdict(w, GU, 'V10', 'K10', { observables: OBS, calendar_events: P.MINIMUM_WINDOW }, false)
    assert.equal(v['verdict'], 'NOT_PROVEN', v['reasons'].join('; '))
    assert.ok(v['reasons'].some((x: string) => /hazard H-SP1 .*never reached/.test(x)), v['reasons'].join('; '))
    assert.ok(!v['reasons'].some((x: string) => /H-ELSEWHERE/.test(x)), 'a hazard outside the closure is not required')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('so cutover to primary is refused until a partial failure is injected and compared', () => {
  const { dir, w } = setup()
  try {
    const c = P.cutover(w, GU, 'primary', 'K10', { observables: OBS })
    assert.equal(c['allowed'], false)
    assert.ok(c['reasons'].some((x: string) => /H-SP1/.test(x)), c['reasons'].join('; '))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the catalog knows the syncpoint hazard and how to reach it', () => {
  const read = (p: string) => readFileSync(new URL(`../../../plugins/rig/${p}`, import.meta.url), 'utf8')
  assert.match(read('skills/rig-method/references/artifacts.md'), /`syncpoint`/)
  assert.match(read('skills/cobol-to-java/references/hazards.md'), /\| `syncpoint` \|/)
})
