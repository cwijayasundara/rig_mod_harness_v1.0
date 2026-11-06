/** Engineering pass (2026-11-06): core changes found by sessions A, B and C, one regression test each. */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import * as P from '../../plugins/rig/scripts/rig_proof.ts'

const GU = 'job:INTCALC'
let dir: string, ws: P.WS
const inp = (n: number) => ({ records: { ACCT: [{ id: String(n) }] }, params: {}, clock: null, stores: {}, session: null })
const obs = (v: string) => ({ return_code: 0, abend: null, messages: [v], stores: {} })
const add = (n: number, classes: string[]) => P.addCase(ws, inp(n), classes, 'characterization', null)['id'] as string
/** Write legacy and modern observations; `bad` ids get a different modern message. */
function observe(name: string, ids: string[], bad: string[] = []) {
  const l = join(dir, 'obs', name, 'l'), m = join(dir, 'obs', name, 'm')
  mkdirSync(l, { recursive: true }); mkdirSync(m, { recursive: true })
  for (const id of ids) {
    writeFileSync(join(l, `${id}.json`), JSON.stringify(obs('A')))
    writeFileSync(join(m, `${id}.json`), JSON.stringify(obs(bad.includes(id) ? 'B' : 'A')))
  }
  return { l, m }
}
const key = (rung = 'V4') => P.evidenceKey(ws, GU, rung, join(dir, 'legacy'), ['modern/Intcalc.java'], 'S', [], {}, {})['key'] as string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-eng-'))
  ws = new P.WS(dir, 'cd')
  mkdirSync(ws.analysis, { recursive: true })
  writeFileSync(join(ws.analysis, 'graph.json'), JSON.stringify({ nodes: [{ id: 'job:INTCALC', loc: 'INTCALC.cbl:1' }], edges: [] }))
  mkdirSync(join(dir, 'legacy'), { recursive: true })
  writeFileSync(join(dir, 'legacy', 'INTCALC.cbl'), 'PROCEDURE DIVISION.')
  mkdirSync(join(dir, 'modern'), { recursive: true })
  writeFileSync(join(dir, 'modern', 'Intcalc.java'), 'class Intcalc {}')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('core 1: a failing fresh case does not move the key of the run that found it', () => {
  test('the key recomputes after the failure, and the verdict sees the failure', () => {
    const pool = Array.from({ length: 24 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const k = key()
    const fresh = [add(100, ['ok']), add(101, ['ok'])]
    const o = observe('r1', [...pool, ...fresh], [fresh[0]!])
    const r = P.judge(ws, 'S', k, o.l, o.m, fresh, undefined, [], 'env')
    assert.equal(r['passed'], r['total'] - 1)
    const s = P.load(ws.setPath('S'))
    assert.ok(s['sealed'].includes(fresh[0]), 'the failing fresh case is sealed for good')
    assert.deepEqual(s['failure_sealed'], [fresh[0]])
    assert.equal(key(), k, 'same code, same set definition: same key')
    const v = P.verdict(ws, GU, 'V4', k, {}, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.match(v['reasons'][0], /1 case\(s\) fail under the current key/)
  })
  test('a case a person adds with set build still changes the key', () => {
    const pool = Array.from({ length: 24 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const k = key()
    P.buildSet(ws, 'S', GU, 'executable', [...pool, add(200, ['ok'])], { ok: 'ok' }, {})
    assert.notEqual(key(), k)
  })
  test('a shadow mismatch sealed into the set does not move the key either', () => {
    const pool = Array.from({ length: 24 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const k = key()
    const t = join(dir, 'traffic'), l = join(dir, 'tl'), m = join(dir, 'tm')
    for (const d of [t, l, m]) mkdirSync(d, { recursive: true })
    writeFileSync(join(t, 'a.json'), JSON.stringify({ input: inp(300) }))
    writeFileSync(join(l, 'a.json'), JSON.stringify(obs('A')))
    writeFileSync(join(m, 'a.json'), JSON.stringify(obs('B')))
    P.shadow(ws, GU, 'K10', t, l, m, undefined, [], 'shadow-env', 'shadow', [], 'S')
    assert.equal(P.load(ws.setPath('S'))['failure_sealed'].length, 1)
    assert.equal(key(), k)
  })
})

describe('core 2: an obligation of requirement class:any discharges', () => {
  test('a passing comparison of its observable discharges it, a failing one keeps it open', () => {
    mkdirSync(ws.obligations, { recursive: true })
    writeFileSync(join(ws.obligations, 'OBL-1.json'), JSON.stringify({ id: 'OBL-1', observables: ['INTCALC.message'], requirement: 'class:any', min_count: 1 }))
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const o = observe('r1', pool)
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    assert.equal(P.discharge(ws)[0]!['status'], 'discharged')
    const fresh = [add(50, ['ok'])]
    const o2 = observe('r2', [...pool, ...fresh], fresh)
    P.judge(ws, 'S', key(), o2.l, o2.m, fresh, undefined, [], 'env')
    assert.equal(P.discharge(ws)[0]!['status'], 'open')
  })
})

describe('core 3: store semantics are compared', () => {
  const withSem = (sem: object | undefined) => ({ return_code: 0, abend: null, stores: { ACCT: { records: [{ id: '1' }], ...(sem ? { semantics: sem } : {}) } } })
  test('equal semantics compare equal and are recorded as store_semantics', () => {
    const c = P.exactCompare(withSem({ collation: 'EBCDIC', range_read: ['A', 'B', '1'] }), withSem({ collation: 'EBCDIC', range_read: ['A', 'B', '1'] }), 'INTCALC')
    assert.ok(c.equal)
    assert.ok(c.compared.includes('INTCALC/ACCT.store_semantics'))
    assert.equal(P.observableIdProblem(GU, 'INTCALC/ACCT.store_semantics'), null)
  })
  test('a changed collation, or a side that probed nothing, is a difference', () => {
    assert.deepEqual(P.exactCompare(withSem({ collation: 'EBCDIC' }), withSem({ collation: 'ASCII' }), 'INTCALC').diffs, ['INTCALC/ACCT.store_semantics'])
    assert.deepEqual(P.exactCompare(withSem({ collation: 'EBCDIC' }), withSem(undefined), 'INTCALC').diffs, ['INTCALC/ACCT.store_semantics'])
  })
  test('no semantics on either side records no store_semantics comparison', () => {
    assert.ok(!P.exactCompare(withSem(undefined), withSem(undefined), 'INTCALC').compared.includes('INTCALC/ACCT.store_semantics'))
  })
  test('semantics values must be strings or lists of strings', () => {
    assert.match(P.observationProblem(withSem({ page_size: 50 }))!, /semantics.page_size/)
  })
  test('the canary sweep changes the semantics, and the built-in comparator catches it', () => {
    const s = withSem({ collation: 'EBCDIC', range_read: ['A', '1'] })
    assert.ok(P.canaryMutations(s, []).some(([, d]) => /store semantics/.test(d)))
    const sweep = P.canarySweep([s], undefined, 'INTCALC', [], join(dir, 'tmp'))
    assert.ok(!sweep['missed'].some((x: string) => /semantics/.test(x)))
  })
})

describe('core 4: judge errors name no case', () => {
  test('a missing observation is a count, never a case id', () => {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const o = observe('r1', pool.slice(2))
    for (const [l, m] of [[o.l, join(dir, 'obs', 'r1', 'none')], [join(dir, 'obs', 'r1', 'none'), o.m]]) {
      mkdirSync(join(dir, 'obs', 'r1', 'none'), { recursive: true })
      assert.throws(() => P.judge(ws, 'S', key(), l!, m!, [], undefined, [], 'env'), (e: Error) => {
        assert.match(e.message, /observation for \d+ of 20 case/)
        for (const id of pool) assert.ok(!e.message.includes(id.slice(0, 8)), 'no case id prefix')
        return true
      })
    }
  })
})

describe('core 6: set build seals at least one case per class', () => {
  test('a class drawn after the sealed minimum is full still gets a sealed case', () => {
    const pool = Array.from({ length: 24 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const hz = [add(400, ['hazard:H-1']), add(401, ['hazard:H-1']), add(402, ['hazard:H-1'])]
    const lone = add(500, ['hazard:H-2'])
    const s = P.buildSet(ws, 'S', GU, 'executable', [...pool, ...hz, lone], { ok: 'ok' }, {})
    assert.equal(hz.filter((id) => s['sealed'].includes(id)).length, 1, 'one sealed, the rest dev')
    assert.equal(s['sealed'].includes([...hz].sort()[0]), true, 'the lowest hash: nobody chooses')
    assert.deepEqual(s['unsealed_classes'], ['hazard:H-2'], 'a class with one input cannot be sealed and also seen')
    assert.ok(s['dev'].includes(lone))
  })
  test('sealed cases never move', () => {
    const pool = Array.from({ length: 24 }, (_, i) => add(i, ['ok']))
    const before = P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})['sealed']
    const after = P.buildSet(ws, 'S', GU, 'executable', [...pool, add(600, ['x']), add(601, ['x'])], { ok: 'ok' }, {})
    for (const id of before) assert.ok(after['sealed'].includes(id))
  })
})

describe('core 7: case add reports a relabel', () => {
  test('adding an input that is already a case says so', () => {
    const a = P.addCase(ws, inp(1), ['class-a'], 'characterization', null)
    assert.equal(a.merged, undefined)
    const b = P.addCase(ws, inp(1), ['class-b'], 'characterization', null)
    assert.equal(b.merged, true)
    assert.deepEqual(b.previous_classes, ['class-a'])
    assert.deepEqual(P.load(ws.casePath(a['id']))['classes'], ['class-a', 'class-b'])
    assert.ok(!('merged' in JSON.parse(readFileSync(ws.casePath(a['id']), 'utf8'))), 'the flag is not written into the case')
  })
  test('the CLI prints merged and a note', () => {
    writeFileSync(join(dir, 'in.json'), JSON.stringify(inp(1)))
    const log = console.log
    let out = ''
    console.log = (s: string) => { out = s }
    try {
      P.main(['case', 'add', '--ws', dir, '--system', 'cd', '--input', join(dir, 'in.json'), '--classes', 'a'])
      P.main(['case', 'add', '--ws', dir, '--system', 'cd', '--input', join(dir, 'in.json'), '--classes', 'b'])
    } finally { console.log = log }
    const j = JSON.parse(out)
    assert.equal(j['merged'], true)
    assert.match(j['note'], /relabel/)
  })
})

describe('core 4, 5, 8, 9: the commands say it', () => {
  const doc = (p: string) => readFileSync(new URL(`../../plugins/rig/${p}`, import.meta.url), 'utf8')
  test('judge.md: run folders unique and lower case; which files go in --comparators; packs from PREFLIGHT', () => {
    const j = doc('commands/judge.md')
    assert.match(j, /unique to this judge run\s+and lower case/)
    assert.match(j, /case-insensitive/)
    assert.match(j, /--comparators` lists every file that decides equality/)
    assert.match(j, /never write `unrecorded`/)
  })
  test('verify.md passes --gate-units to the architecture check', () => {
    assert.match(doc('commands/verify.md'), /rig_arch\.ts check[^`]*--gate-units \$gate_unit/)
  })
  test('preflight.md records the Pack versions block', () => {
    assert.match(doc('commands/preflight.md'), /\*\*Pack versions\*\* block/)
  })
  test('rig-method: no background waits, helper scripts in TypeScript', () => {
    const m = doc('skills/rig-method/SKILL.md')
    assert.match(m, /Never use Monitor, ScheduleWakeup/)
    assert.match(m, /Helper scripts are TypeScript/)
  })
})
