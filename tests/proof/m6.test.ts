/** M6 (data and cutover): shadow runs, calendar coverage from traffic, V9 timing, cutover stages, go/no-go a person's. */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { decide } from '../../plugins/rig/hooks/guard.ts'
import * as P from '../../plugins/rig/scripts/rig_proof.ts'

const GU = 'job:READCUST'
let dir: string, ws: P.WS
const obs = (msgs: string[], ms?: number, clock?: string) => ({ return_code: 0, abend: null, messages: msgs, stores: {}, ...(ms != null && { elapsed_ms: ms }), ...(clock && { clock_applied: clock }) })
let APPLY = true

/** One traffic item per clock, both sides written; `bad` names the clocks where modern differs. */
function day(name: string, clocks: string[], bad: string[] = [], ms: [number, number] = [100, 120]) {
  for (const side of ['t', 'l', 'm']) mkdirSync(join(dir, name, side), { recursive: true })
  for (const clock of clocks) {
    const f = `${clock.slice(0, 10)}.json`
    writeFileSync(join(dir, name, 't', f), JSON.stringify({ input: { records: { CUSTFILE: [] }, params: {}, clock, stores: {}, session: null } }))
    writeFileSync(join(dir, name, 'l', f), JSON.stringify(obs(['A'], ms[0], APPLY ? clock : undefined)))
    writeFileSync(join(dir, name, 'm', f), JSON.stringify(obs(bad.includes(clock) ? ['B'] : ['A'], ms[1], APPLY ? clock : undefined)))
  }
  return { t: join(dir, name, 't'), l: join(dir, name, 'l'), m: join(dir, name, 'm') }
}
const run = (d: ReturnType<typeof day>, stage = 'shadow', set?: string) =>
  P.shadow(ws, GU, 'K10', d.t, d.l, d.m, undefined, [], 'shadow-env', stage, [], set)
const goes = (...stages: string[]) => {
  mkdirSync(join(dir, 'cutover', 'cd'), { recursive: true })
  writeFileSync(join(dir, 'cutover', 'cd', 'job_READCUST.json'), JSON.stringify({ stages: stages.map((s) => ({ stage: s, go_by: 'owner', go_on: '2026-11-06' })) }))
}
const REQ = { observables: ['READCUST.message', 'READCUST.return_code'], calendar_events: P.MINIMUM_WINDOW }
// Mon 2 Nov .. Fri 6 Nov 2026, 30 Sep (Wed), 31 Oct (Sat), 28 Feb 2027 (Sun), 31 Dec 2026 (Thu, quarter end)
const WINDOW = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-09-30', '2026-10-31', '2027-02-28', '2026-12-31']
  .map((d) => `${d}T02:00:00Z`)

beforeEach(() => { APPLY = true; dir = mkdtempSync(join(tmpdir(), 'rig-m6-')); ws = new P.WS(dir, 'cd') })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('shadow runs', () => {
  test('are recorded under the V10 key with coverage, stage and calendar events from the traffic clocks', () => {
    const out = run(day('d1', WINDOW))
    assert.equal(out['passed'], 9)
    assert.deepEqual(out['calendar_events'].filter((e: string) => P.MINIMUM_WINDOW.includes(e)).sort(), [...P.MINIMUM_WINDOW].sort())
    const r = [...P.allRuns(ws)][0]!
    assert.equal(r['mode'], 'shadow')
    assert.equal(r['stage'], 'shadow')
    assert.equal(r['coverage']['timing']['cases'], 9)
  })
  test('a mismatch joins the sealed set, so a difference found in traffic is never lost', () => {
    mkdirSync(join(ws.oracles, 'sets'), { recursive: true })
    writeFileSync(ws.setPath('S'), JSON.stringify({ name: 'S', gate_unit: GU, mode: 'executable', dev: [], sealed: [], required_classes: {} }))
    const out = run(day('d1', WINDOW.slice(0, 2), [WINDOW[1]!]), 'shadow', 'S')
    assert.equal(out['mismatches'], 1)
    assert.equal(P.load(ws.setPath('S'))['sealed'].length, 1)
  })
  test('one short shadow does not cover the calendar minimum window, and the V10 verdict says which events are missing', () => {
    run(day('d1', WINDOW.slice(0, 1)))
    const v = P.verdict(ws, GU, 'V10', 'K10', REQ, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok((v['reasons'] as string[]).some((x) => /calendar event quarter_end not covered/.test(x)))
  })
  test('a comparator with ids outside the grammar is refused in shadow too', () => {
    const d = day('d1', WINDOW.slice(0, 1))
    const cmp = join(dir, 'cmp.ts')
    writeFileSync(cmp, "console.log(JSON.stringify({equal: true, compared: ['READCUST/return_code']}))\n")
    assert.throws(() => P.shadow(ws, GU, 'K10', d.t, d.l, d.m, `node ${cmp}`, [], 'e', 'shadow'), /outside the observable id grammar/)
  })
})

describe('calendar events need the clock applied (M6 exit run)', () => {
  test('a clock that is only a label covers no calendar event', () => {
    APPLY = false
    const out = run(day('d1', WINDOW))
    assert.deepEqual(out['calendar_events'], [])
    assert.equal([...P.allRuns(ws)][0]!['coverage']['clock_not_applied']['cases'], 9)
    assert.ok((P.verdict(ws, GU, 'V10', 'K10', REQ, false)['reasons'] as string[]).some((x) => /calendar event weekday_mon not covered/.test(x)))
  })
})

describe('V9 timing', () => {
  test('modern slower than the limit is a gap; within it is not; no timing is a gap', () => {
    run(day('d1', WINDOW, [], [100, 300]))
    const slow = P.verdict(ws, GU, 'V10', 'K10', { ...REQ, timing_max_ratio: 2 }, false)
    assert.ok((slow['reasons'] as string[]).some((x) => /3\.00x legacy/.test(x)))
    assert.equal(P.verdict(ws, GU, 'V10', 'K10', { ...REQ, timing_max_ratio: 4 }, false)['verdict'], 'PROVEN')
  })
})

describe('cutover stages', () => {
  test('nothing moves without a person\'s go', () => {
    const c = P.cutover(ws, GU, 'shadow', 'K10', REQ)
    assert.equal(c['allowed'], false)
    assert.match(c['reasons'][0], /no go from a person for shadow/)
    goes('shadow')
    assert.equal(P.cutover(ws, GU, 'shadow', 'K10', REQ)['allowed'], true)
  })
  test('canary needs a clean shadow and every obligation on the entry discharged (canary traffic is real)', () => {
    goes('shadow', 'canary')
    assert.ok(P.cutover(ws, GU, 'canary', 'K10', REQ)['reasons'].some((x: string) => /no shadow run/.test(x)))
    run(day('d1', WINDOW))
    mkdirSync(ws.obligations, { recursive: true })
    writeFileSync(join(ws.obligations, 'OBL-1.json'), JSON.stringify({ id: 'OBL-1', observables: ['READCUST.message'], requirement: 'hazard:H-0012', min_count: 1, status: 'open', accepted_by: 'owner' }))
    const c = P.cutover(ws, GU, 'canary', 'K10', REQ)
    assert.equal(c['allowed'], false)
    assert.ok(c['reasons'].some((x: string) => /1 obligation\(s\) on this entry point not discharged: OBL-1/.test(x)), 'accepted is not discharged')
  })
  test('primary needs the V10 verdict, which includes the calendar window', () => {
    goes('shadow', 'canary', 'primary')
    run(day('d1', WINDOW.slice(0, 3)))
    const c = P.cutover(ws, GU, 'primary', 'K10', REQ)
    assert.equal(c['allowed'], false)
    assert.ok(c['reasons'].some((x: string) => /V10 verdict is NOT_PROVEN/.test(x)))
    run(day('d2', WINDOW))
    assert.equal(P.cutover(ws, GU, 'primary', 'K10', REQ)['allowed'], true)
  })
  test('a stage cannot be skipped, and decommission needs real (canary or primary) traffic', () => {
    goes('primary')
    assert.ok(P.cutover(ws, GU, 'primary', 'K10', REQ)['reasons'].some((x: string) => /stage shadow was never entered/.test(x)))
    goes('shadow', 'canary', 'primary', 'decommission')
    run(day('d1', WINDOW))
    assert.ok(P.cutover(ws, GU, 'decommission', 'K10', REQ)['reasons'].some((x: string) => /no canary or primary run/.test(x)))
    run(day('d2', WINDOW.slice(0, 1)), 'canary')
    assert.equal(P.cutover(ws, GU, 'decommission', 'K10', REQ)['allowed'], true)
  })
})

describe('guard: go/no-go is a person\'s', () => {
  test('a subagent may not write cutover/', () => {
    const call = (agent?: string) => decide({ tool_name: 'Write', tool_input: { file_path: '/ws/cutover/cd/job_READCUST.json' }, cwd: '/ws', ...(agent && { agent_type: agent }) }, '/ws')
    assert.match(call('rig:judge')!, /person's decision/)
    assert.equal(call(), null)
  })
})
