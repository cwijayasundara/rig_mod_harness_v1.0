/** Engineering pass (2026-11-06): core changes found by sessions A, B and C, one regression test each. */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
  test('round 2 item 21: every semantics key is mutated, so a comparator that ignores one is not trusted', () => {
    const s = withSem({ collation: 'EBCDIC', range_read: ['A', '1'], duplicates: 'rejected' })
    const muts = P.canaryMutations(s, []).filter(([, d]) => /store semantics/.test(d)).map(([, d]) => d)
    for (const k of ['collation', 'range_read', 'duplicates']) assert.ok(muts.some((d) => d.includes(k)), `mutates ${k}`)
    // A comparator that reads only the first key (collation), as ENG-D's finding 4 describes.
    const cmp = join(dir, 'first_key_cmp.ts')
    writeFileSync(cmp, `import { readFileSync } from 'node:fs'
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')))
const sem = (o: any) => o.stores?.ACCT?.semantics?.collation ?? null
const eq = JSON.stringify([a.return_code, a.abend, a.stores?.ACCT?.records, sem(a)]) === JSON.stringify([b.return_code, b.abend, b.stores?.ACCT?.records, sem(b)])
console.log(JSON.stringify({ equal: eq, compared: ['INTCALC.return_code', 'INTCALC.abend', 'INTCALC/ACCT.store_semantics'] }))
`)
    const sweep = P.canarySweep([s], `node ${cmp}`, 'INTCALC', [], join(dir, 'tmp'))
    assert.equal(sweep['trusted'], false)
    assert.ok(sweep['missed'].some((x: string) => /store semantics range_read/.test(x)))
    assert.ok(sweep['missed'].some((x: string) => /store semantics duplicates/.test(x)))
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
    assert.deepEqual(s['classes_without_dev'], [])
    assert.ok(s['dev'].includes(lone))
  })
  test('round 2 item 20: the report is computed after the fill, so a one-case class the fill sealed is not "unsealed"', () => {
    // ENG-D's V7 set: recorded mode, one case, and the 25% fill seals it.
    const id = P.addCase(ws, inp(700), ['migration:CUSTFILE'], 'characterization', obs('A'))['id'] as string
    const s = P.buildSet(ws, 'V7', GU, 'recorded', [id], { 'migration:CUSTFILE': 'one dataset' }, {})
    assert.deepEqual(s['sealed'], [id])
    assert.deepEqual(s['unsealed_classes'], [], 'it is sealed')
    assert.deepEqual(s['classes_without_dev'], ['migration:CUSTFILE'], 'and the worker sees no case of it')
  })
  test('round 2 item 20: a class the fill seals completely is reported as having no dev case', () => {
    // Executable mode, 20 sealed wanted, 21 cases: the fill seals every case of class y except none is left for dev.
    const ok = Array.from({ length: 19 }, (_, i) => add(900 + i, ['ok']))
    const y = [add(950, ['y']), add(951, ['y'])]
    const s = P.buildSet(ws, 'S', GU, 'executable', [...ok, ...y], { ok: 'ok', y: 'y' }, {})
    assert.ok(y.every((i) => s['sealed'].includes(i)), 'the 20-case minimum sealed both y cases')
    assert.deepEqual(s['classes_without_dev'], ['y'])
    for (const cl of s['classes_without_dev']) assert.ok(!s['dev'].some((d: string) => P.load(ws.casePath(d))['classes'].includes(cl)))
    for (const cl of s['unsealed_classes']) assert.ok(!s['sealed'].some((d: string) => P.load(ws.casePath(d))['classes'].includes(cl)))
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
    assert.match(m, /pass `run_in_background: false` on\s+each Agent call/)
    assert.match(m, /Scripts are TypeScript/)
    assert.match(m, /each\s+side's runner/)
    assert.match(doc('agents/worker.md'), /runner in TypeScript/)
  })
})

describe('round 2 item 17: rig_http.ts exits as soon as the run is done', () => {
  test('one case against an app that stops on SIGTERM takes seconds, not the 60 s shutdown allowance', () => {
    const srv = join(dir, 'srv.mjs')
    writeFileSync(srv, `import { createServer } from 'node:http'
createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<p>ok</p>') }).listen(Number(process.argv[2]), '127.0.0.1')
`)
    const c = join(dir, 'http-case.json')
    writeFileSync(c, JSON.stringify({ records: { requests: [{ method: 'GET', path: '/' }] }, params: {}, clock: null, stores: {}, session: null }))
    const t0 = Date.now()
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../plugins/rig/scripts/rig_http.ts', import.meta.url)), 'run',
      '--case', c, '--out', join(dir, 'http-out.json'), '--start', `node ${srv} {port}`, '--workdir', join(dir, 'http-wd')],
      { encoding: 'utf8', timeout: 40_000 })
    const ms = Date.now() - t0
    assert.equal(r.status, 0, `exit ${r.status} ${r.signal ?? ''} ${r.stdout} ${r.stderr}`)
    assert.ok(ms < 15_000, `took ${ms} ms`)
    const o = P.load(join(dir, 'http-out.json'))
    assert.equal(o['abend'], null)
    assert.equal(o['screens'].length, 1)
  })
})

describe('round 2 item 22: judge counts show required classes that had no case', () => {
  test('a required class with no case is printed as 0 of 0, and does not fail the run', () => {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok', 'hazard:H-0012': 'invalid packed data' }, {})
    const o = observe('r1', pool)
    const r = P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    assert.deepEqual(r['classes'].find((c: any) => c.class === 'hazard:H-0012'),
      { class: 'hazard:H-0012', description: 'invalid packed data', passed: 0, total: 0 })
    assert.equal(r['passed'], r['total'])
  })
})
