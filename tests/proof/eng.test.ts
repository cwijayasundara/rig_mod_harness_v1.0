/** Engineering pass (2026-11-06): core changes found by sessions A, B and C, one regression test each. */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  test('judge.md and proof.md say how a case that cannot run is recorded', () => {
    assert.match(doc('commands/judge.md'), /\{"not_run": "<reason>"\}/)
    assert.match(doc('skills/rig-method/references/proof.md'), /exits 4 and writes `\{"not_run"/)
  })
  test('judge.md: plugin runner, one judge and two JVMs at a time, exit 1 on not_run; oracles.md: small domains', () => {
    const j = doc('commands/judge.md')
    assert.match(j, /plugin:scripts\/rig_http\.ts/)
    assert.match(j, /one judge at a time on a machine, with at most two application processes/)
    assert.match(j, /1 when a case failed \*\*or\*\* was not run/)
    assert.match(doc('commands/oracles.md'), /small finite domain/)
  })
  test('verify.md requires timing_max_ratio for <U>.timing; proof.md: HTTP stores print semantics', () => {
    assert.match(doc('commands/verify.md'), /[Rr]equired when the surface lists `<U>\.timing`/)
    assert.match(doc('skills/rig-method/references/proof.md'), /stores command to print each table's `semantics`/)
  })
  test('repeat and class_observables are documented where runners, sets and the Spring hazards are written', () => {
    assert.match(doc('skills/rig-method/references/proof.md'), /"repeat": N/)
    assert.match(doc('agents/worker.md'), /write runs 2\.\.N in `repeats`/)
    assert.match(doc('commands/oracles.md'), /--class-observables/)
    assert.match(doc('skills/cobol-to-spring/references/spring-hazards.md'), /"repeat": 2/)
  })
  test('input_digest is part of the runner contract and the requirements', () => {
    assert.match(doc('skills/rig-method/references/proof.md'), /"input_digest"/)
    assert.match(doc('agents/worker.md'), /write `input_digest`/)
    assert.match(doc('commands/verify.md'), /`input_digests`: `true`/)
  })
  test('reconcile mode and --harness are documented for V7', () => {
    assert.match(doc('skills/store-replatform/SKILL.md'), /set build --mode reconcile/)
    assert.match(doc('commands/judge.md'), /`--harness` lists the oracle harness files/)
    assert.match(doc('commands/oracles.md'), /A third\s+mode, `reconcile`/)
  })
  test('owner decisions 23, 25, 29, 33 are in the commands and agents', () => {
    assert.match(doc('commands/verify.md'), /work\/\$system\/caps\/CAP-\*\.draft\.json/)
    assert.match(doc('commands/review.md'), /moves a draft to/)
    assert.match(doc('skills/rig-method/references/proof.md'), /A case's `expected` never changes/)
    assert.match(doc('commands/judge.md'), /or in a main\s+session that will not change `modernized\/` afterwards/)
    assert.match(doc('agents/fixer.md'), /A runner-contract change/)
    assert.match(doc('commands/oracles.md'), /hand the contract to the fixer/)
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

describe('round 2 item 16: a case whose clock cannot be applied is recorded as not run, never dropped', () => {
  const NR = { not_run: 'clock 2026-11-05T10:00:00Z needs a --clock-wrap, or a run on 2026-11-05 UTC' }
  /** Observations where the cases in `nr` were not run on the sides named. */
  function observeNR(name: string, ids: string[], nr: string[], sides: ('l' | 'm')[] = ['l', 'm'], bad: string[] = []) {
    const o = observe(name, ids, bad)
    for (const id of nr) for (const s of sides) writeFileSync(join(s === 'l' ? o.l : o.m, `${id}.json`), JSON.stringify(NR))
    return o
  }
  const setup = () => {
    const pool = Array.from({ length: 22 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    return pool
  }
  test('rig_http writes {not_run} and exits 4 for a clock it cannot apply', () => {
    const c = join(dir, 'clock-case.json')
    writeFileSync(c, JSON.stringify({ records: { requests: [{ method: 'GET', path: '/' }] }, params: {}, clock: '2020-01-01T10:00:00Z', stores: {}, session: null }))
    const out = join(dir, 'clock-out.json')
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../plugins/rig/scripts/rig_http.ts', import.meta.url)), 'run',
      '--case', c, '--out', out, '--start', 'true'], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(r.status, 4, r.stdout)
    assert.match(P.load(out)['not_run'], /clock 2020-01-01/)
  })
  test('a case not run on both sides is counted, not compared, and the run is recorded', () => {
    const pool = setup()
    const o = observeNR('r1', pool, [pool[0]!])
    const r = P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    assert.equal(r['not_run'], 1)
    assert.equal(r['total'], 21)
    assert.equal(r['passed'], 21)
    assert.equal(r['classes'].find((c: any) => c.class === 'ok').not_run, 1)
    const s = P.load(ws.setPath('S'))
    assert.deepEqual(s['failed_classes'], [], 'not run is not a failure')
    assert.equal(s['failure_sealed'], undefined)
  })
  test('the verdict names the cases that never ran as a gap, and an accepted obligation makes it PROVISIONAL', () => {
    const pool = setup()
    const o = observeNR('r1', pool, [pool[0]!, pool[1]!])
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const v = P.verdict(ws, GU, 'V4', key(), {}, true)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((x: string) => /2 case\(s\) never ran on both sides/.test(x)), v['reasons'].join('; '))
    for (const f of readdirSync(ws.obligations)) {
      const ob = P.load(join(ws.obligations, f))
      if (ob['requirement'] === 'not_run') writeFileSync(join(ws.obligations, f), JSON.stringify({ ...ob, accepted_by: 'owner' }))
    }
    assert.equal(P.verdict(ws, GU, 'V4', key(), {}, false)['verdict'], 'PROVISIONAL')
  })
  test('a later run that compares the case closes the gap', () => {
    const pool = setup()
    const o = observeNR('r1', pool, [pool[0]!])
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const o2 = observe('r2', pool)
    P.judge(ws, 'S', key(), o2.l, o2.m, [], undefined, [], 'env')
    assert.equal(P.verdict(ws, GU, 'V4', key(), {}, false)['verdict'], 'PROVEN')
  })
  test('one side not run while the other ran is refused: a runner cannot skip what it fails', () => {
    const pool = setup()
    const o = observeNR('r1', pool, [pool[0]!], ['m'])
    assert.throws(() => P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env'), /not run on one side only/)
  })
  test('a failure stays a failure when a later run could not run the case', () => {
    const pool = setup()
    const o = observe('r1', pool, [pool[0]!])
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const fr = add(991, ['ok']) // the failed class must come back with a fresh input (§5.3 rule 3)
    const o2 = observeNR('r2', [...pool, fr], [pool[0]!])
    P.judge(ws, 'S', key(), o2.l, o2.m, [fr], undefined, [], 'env')
    const v = P.verdict(ws, GU, 'V4', key(), {}, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.match(v['reasons'][0], /1 case\(s\) fail/)
  })
  test('a failed class is not brought back by a fresh input that did not run', () => {
    const pool = setup()
    const o = observe('r1', pool, [pool[0]!])
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const fr = add(992, ['ok'])
    const o2 = observeNR('r2', [...pool, fr], [fr])
    assert.throws(() => P.judge(ws, 'S', key(), o2.l, o2.m, [fr], undefined, [], 'env'), /fresh inputs that run/)
    assert.equal(readdirSync(join(ws.evidence, key())).length, 1, 'the refused run wrote nothing')
  })
  test('a fresh case that did not run is not a fresh input compared against legacy', () => {
    const pool = setup()
    const fr = add(990, ['ok'])
    const o = observeNR('r1', [...pool, fr], [fr])
    const r = P.judge(ws, 'S', key(), o.l, o.m, [fr], undefined, [], 'env')
    assert.equal(r['not_run'], 1)
    const v = P.verdict(ws, GU, 'V4', key(), { fresh_classes: ['ok'] }, false)
    assert.ok(v['reasons'].some((x: string) => /class ok had no fresh input compared/.test(x)), v['reasons'].join('; '))
  })
})

describe('round 2 items 18/28: a key can hash the plugin\'s own runner without a copy', () => {
  const k = (modern: string[], comparators: string[] = []) =>
    P.evidenceKey(ws, GU, 'V3', join(dir, 'legacy'), modern, undefined, comparators, {}, {})['key'] as string
  test('plugin:<path> is hashed from the plugin, under that name, so the key does not depend on where the workspace is', () => {
    const a = k(['modern/Intcalc.java', 'plugin:scripts/rig_http.ts'])
    assert.notEqual(a, k(['modern/Intcalc.java']), 'the runner is part of the key')
    // The same key from another workspace with the same modern file.
    const other = mkdtempSync(join(tmpdir(), 'rig-eng-b-'))
    try {
      const ws2 = new P.WS(other, 'cd')
      mkdirSync(ws2.analysis, { recursive: true })
      writeFileSync(join(ws2.analysis, 'graph.json'), readFileSync(join(ws.analysis, 'graph.json')))
      mkdirSync(join(other, 'modern'), { recursive: true })
      writeFileSync(join(other, 'modern', 'Intcalc.java'), 'class Intcalc {}')
      const b = P.evidenceKey(ws2, GU, 'V3', join(dir, 'legacy'), ['modern/Intcalc.java', 'plugin:scripts/rig_http.ts'], undefined, [], {}, {})['key']
      assert.equal(b, a)
    } finally { rmSync(other, { recursive: true, force: true }) }
  })
  test('a plugin path that does not exist, or one that leaves the plugin, is refused', () => {
    assert.throws(() => k(['modern/Intcalc.java', 'plugin:scripts/nope.ts']), /does not exist/)
    assert.throws(() => k(['modern/Intcalc.java', 'plugin:../README.md']), /inside the plugin/)
  })
  test('an absolute path is refused with a pointer to plugin: or a workspace-relative path', () => {
    assert.throws(() => k(['modern/Intcalc.java', join(dir, 'modern', 'Intcalc.java')]), /absolute.*plugin:/)
  })
  test('comparators may name a plugin file too', () => {
    assert.notEqual(P.evidenceKey(ws, GU, 'V3', join(dir, 'legacy'), ['modern/Intcalc.java'], undefined, ['plugin:scripts/rig_http.ts'], {}, {})['key'],
      P.evidenceKey(ws, GU, 'V3', join(dir, 'legacy'), ['modern/Intcalc.java'], undefined, [], {}, {})['key'])
  })
})

describe('round 2 item 27: timing and HTTP store semantics are recorded', () => {
  const timed = (ms: number, extra: object = {}) => ({ ...obs('A'), elapsed_ms: ms, ...extra })
  function observeTimed(name: string, ids: string[], lms: number, mms: number) {
    const l = join(dir, 'obs', name, 'l'), m = join(dir, 'obs', name, 'm')
    mkdirSync(l, { recursive: true }); mkdirSync(m, { recursive: true })
    for (const id of ids) { writeFileSync(join(l, `${id}.json`), JSON.stringify(timed(lms))); writeFileSync(join(m, `${id}.json`), JSON.stringify(timed(mms))) }
    return { l, m }
  }
  const setup = () => {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    return pool
  }
  test('a judge run with elapsed_ms on both sides compares <U>.timing and records the timing', () => {
    const pool = setup()
    const o = observeTimed('r1', pool, 100, 150)
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const run = [...P.allRuns(ws)][0]!
    assert.equal(run['coverage']['observables']['INTCALC.timing'], 20)
    assert.deepEqual(run['coverage']['timing'], { cases: 20, legacy_ms: 2000, modern_ms: 3000, modern_max_ms: 150 })
    const req = { observables: ['INTCALC.timing', 'INTCALC.message'], timing_max_ratio: 2 }
    assert.equal(P.verdict(ws, GU, 'V4', key(), req, false)['verdict'], 'PROVEN')
    const slow = P.verdict(ws, GU, 'V4', key(), { ...req, timing_max_ratio: 1.2 }, false)
    assert.equal(slow['verdict'], 'NOT_PROVEN')
    assert.ok(slow['reasons'].some((x: string) => /1\.50x legacy/.test(x)))
  })
  test('timing never makes a case fail: a slower modern side is a V9 gap, not a mismatch', () => {
    const pool = setup()
    const o = observeTimed('r1', pool, 100, 900)
    const r = P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    assert.equal(r['passed'], r['total'])
  })
  test('a surface that lists <U>.timing with no timing_max_ratio is a gap (compared against nothing)', () => {
    const pool = setup()
    const o = observeTimed('r1', pool, 100, 100)
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const v = P.verdict(ws, GU, 'V4', key(), { observables: ['INTCALC.timing'] }, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((x: string) => /INTCALC\.timing.*timing_max_ratio/.test(x)), v['reasons'].join('; '))
  })
  test('without elapsed_ms on both sides <U>.timing stays never compared', () => {
    const pool = setup()
    const o = observe('r1', pool)
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const v = P.verdict(ws, GU, 'V4', key(), { observables: ['INTCALC.timing'], timing_max_ratio: 2 }, false)
    assert.ok(v['reasons'].some((x: string) => /INTCALC\.timing was never compared/.test(x)), v['reasons'].join('; '))
  })
  test('rig_http records elapsed_ms, and keeps the semantics a stores command prints', () => {
    const srv = join(dir, 'srv2.mjs')
    writeFileSync(srv, `import { createServer } from 'node:http'
createServer((q, s) => { s.writeHead(200); s.end('ok') }).listen(Number(process.argv[2]), '127.0.0.1')
`)
    const c = join(dir, 'http-case2.json')
    writeFileSync(c, JSON.stringify({ records: { requests: [{ method: 'GET', path: '/' }] }, params: {}, clock: null, stores: {}, session: null }))
    const stores = join(dir, 'stores.mjs')
    writeFileSync(stores, `console.log(JSON.stringify({ owners: { records: [{ id: '1' }], semantics: { collation: 'UNICODE' } } }))`)
    const out = join(dir, 'http-out2.json')
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../plugins/rig/scripts/rig_http.ts', import.meta.url)), 'run',
      '--case', c, '--out', out, '--start', `node ${srv} {port}`, '--stores-cmd', `node ${stores}`], { encoding: 'utf8', timeout: 30_000 })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const o = P.load(out)
    assert.equal(typeof o['elapsed_ms'], 'number')
    assert.ok(o['elapsed_ms'] >= 0)
    assert.deepEqual(o['stores']['owners']['semantics'], { collation: 'UNICODE' })
    assert.ok(P.exactCompare(o, o, 'GET /').compared.includes('GET //owners.store_semantics'))
  })
})

describe('round 2 item 10: repeat runs (S-RESTART) and classes that need an observable (S-STARTUP)', () => {
  const rinp = (n: number, repeat?: number) => ({ ...inp(n), ...(repeat ? { repeat } : {}) })
  test('repeat is an optional input key: existing case ids do not change, and it must be an integer of at least 2', () => {
    assert.equal(P.caseId(inp(1)), P.caseId(rinp(1)))
    assert.notEqual(P.caseId(rinp(1, 2)), P.caseId(inp(1)))
    assert.throws(() => P.caseId(rinp(1, 1)), /repeat/)
    assert.throws(() => P.caseId({ ...inp(1), repeat: '2' }), /repeat/)
  })
  test('exact compares every repeat run and records <U>.repeat', () => {
    const a = { ...obs('A'), repeats: [obs('A')] }
    const same = P.exactCompare(a, structuredClone(a), 'INTCALC')
    assert.ok(same.equal)
    assert.ok(same.compared.includes('INTCALC.repeat'))
    const second = P.exactCompare(a, { ...obs('A'), repeats: [obs('already complete')] }, 'INTCALC')
    assert.ok(!second.equal, 'S-RESTART: the second run does nothing')
    assert.ok(second.diffs.includes('INTCALC.repeat'))
    assert.ok(!P.exactCompare(a, obs('A'), 'INTCALC').equal, 'a side that ran once differs')
    assert.equal(P.observableIdProblem(GU, 'INTCALC.repeat'), null)
  })
  const setWith = (classObs?: Record<string, string[]>) => {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    const rp = [P.addCase(ws, rinp(50, 2), ['hazard:S-RESTART'], 'hazard', null)['id'] as string,
                P.addCase(ws, rinp(51, 2), ['hazard:S-RESTART'], 'hazard', null)['id'] as string]
    P.buildSet(ws, 'S', GU, 'executable', [...pool, ...rp], { ok: 'ok', 'hazard:S-RESTART': 'run twice' }, {}, [], classObs)
    return { pool, rp }
  }
  function observeRepeat(name: string, pool: string[], rp: string[], modernSecond = 'A', sides: ('l' | 'm')[] = ['l', 'm']) {
    const o = observe(name, [...pool, ...rp])
    for (const id of rp) {
      if (sides.includes('l')) writeFileSync(join(o.l, `${id}.json`), JSON.stringify({ ...obs('A'), repeats: [obs('A')] }))
      if (sides.includes('m')) writeFileSync(join(o.m, `${id}.json`), JSON.stringify({ ...obs('A'), repeats: [obs(modernSecond)] }))
    }
    return o
  }
  test('a repeat case whose second run differs fails; one that matches passes and reaches the hazard', () => {
    const { pool, rp } = setWith({ 'hazard:S-RESTART': ['INTCALC.repeat'] })
    const o = observeRepeat('r1', pool, rp)
    const r = P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    assert.equal(r['passed'], r['total'])
    assert.equal([...P.allRuns(ws)][0]!['coverage']['hazards']['S-RESTART'], 2)
    const o2 = observeRepeat('r2', pool, rp, 'already complete')
    const r2 = P.judge(ws, 'S', key(), o2.l, o2.m, [], undefined, [], 'env')
    assert.equal(r2['total'] - r2['passed'], 2)
  })
  test('the canary sweep changes the repeat runs, so a comparator that ignores them is not trusted', () => {
    const sample = { ...obs('A'), messages: ['A', 'B'], repeats: [{ ...obs('A'), messages: ['A', 'B'] }] }
    const muts = P.canaryMutations(sample, []).map(([, d]) => d)
    assert.ok(muts.some((d) => /repeats: drop the last run/.test(d)))
    assert.ok(muts.some((d) => /repeats\[0\]/.test(d)))
    const cmp = join(dir, 'first_run_cmp.ts')
    writeFileSync(cmp, `import { readFileSync } from 'node:fs'
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')))
const k = (o: any) => JSON.stringify([o.return_code, o.abend, o.messages])
console.log(JSON.stringify({ equal: k(a) === k(b), compared: ['INTCALC.return_code', 'INTCALC.abend', 'INTCALC.message', 'INTCALC.repeat'] }))
`)
    const sweep = P.canarySweep([sample], `node ${cmp}`, 'INTCALC', [], join(dir, 'tmp'))
    assert.equal(sweep['trusted'], false)
    assert.ok(sweep['missed'].some((x: string) => /repeats/.test(x)))
    assert.equal(P.canarySweep([sample], undefined, 'INTCALC', [], join(dir, 'tmp'))['trusted'], true)
  })
  test('a runner that ignored repeat is refused', () => {
    const { pool, rp } = setWith()
    const o = observeRepeat('r1', pool, rp, 'A', ['l']) // modern ran once
    assert.throws(() => P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env'), /repeat 2.*ran 1 time/)
  })
  test('a custom comparator that does not report <U>.repeat on a repeat case is refused', () => {
    const { pool, rp } = setWith()
    const o = observeRepeat('r1', pool, rp)
    const cmp = join(dir, 'once_cmp.ts')
    writeFileSync(cmp, `console.log(JSON.stringify({ equal: true, compared: ['INTCALC.return_code', 'INTCALC.message'] }))`)
    assert.throws(() => P.judge(ws, 'S', key(), o.l, o.m, [], `node ${cmp}`, [], 'env'), /did not compare the repeat runs/)
  })
  test('class_observables: a hazard case counts only when it compared what reaches the hazard (S-STARTUP needs timing)', () => {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    const st = [add(60, ['hazard:S-STARTUP']), add(61, ['hazard:S-STARTUP'])]
    P.buildSet(ws, 'S', GU, 'executable', [...pool, ...st], { ok: 'ok', 'hazard:S-STARTUP': 'start-up time' }, {}, [], { 'hazard:S-STARTUP': ['INTCALC.timing'] })
    const o = observe('r1', [...pool, ...st]) // no elapsed_ms: not timed
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const run = [...P.allRuns(ws)][0]!
    assert.equal(run['coverage']['hazards']['S-STARTUP'] ?? 0, 0)
    assert.equal(run['coverage']['class_unreached']['hazard:S-STARTUP'], 2)
    const v = P.verdict(ws, GU, 'V4', key(), { hazards: ['S-STARTUP'] }, false)
    assert.ok(v['reasons'].some((x: string) => /hazard S-STARTUP was never reached/.test(x)))
    // Timed: it counts.
    for (const id of st) for (const side of [o.l, o.m]) writeFileSync(join(side, `${id}.json`), JSON.stringify({ ...obs('A'), elapsed_ms: 900 }))
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    assert.ok(!P.verdict(ws, GU, 'V4', key(), { hazards: ['S-STARTUP'] }, false)['reasons'].some((x: string) => /S-STARTUP/.test(x)))
  })
  test('class_observables are part of the set definition, so the key changes with them; a set without them keeps its hash', () => {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    const plain = P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const h0 = P.setHash(plain)
    assert.equal(h0, P.setHash({ ...plain, class_observables: {} }))
    const withObs = P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {}, [], { ok: ['INTCALC.message'] })
    assert.notEqual(P.setHash(withObs), h0)
  })
})

describe('round 2 item 11: inputs the modern side receives identically while legacy does not are a gap', () => {
  const dobs = (v: string, digest?: string) => ({ ...obs(v), ...(digest ? { input_digest: digest } : {}) })
  /** Cases with digests per side: [caseIndex, legacyDigest, modernDigest]. */
  function setupDigests(rows: [number, string | undefined, string | undefined][]) {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    const extra = rows.map(([n]) => add(n, ['store:status']))
    P.buildSet(ws, 'S', GU, 'executable', [...pool, ...extra], { ok: 'ok', 'store:status': 'file states' }, {})
    const o = observe('r1', [...pool, ...extra])
    rows.forEach(([, ld, md], i) => {
      writeFileSync(join(o.l, `${extra[i]}.json`), JSON.stringify(dobs('A', ld)))
      writeFileSync(join(o.m, `${extra[i]}.json`), JSON.stringify(dobs('A', md)))
    })
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    return extra
  }
  test('an empty KSDS and an empty plain file that reach the modern side as the same bytes are recorded and are a gap', () => {
    const [a, b] = setupDigests([[300, 'ksds-empty', 'flat-empty'], [301, 'plain-empty', 'flat-empty'], [302, 'ksds-3', 'flat-3']])
    const run = [...P.allRuns(ws)][0]!
    assert.deepEqual(run['coverage']['ambiguous_inputs'], [[a, b].sort()])
    const v = P.verdict(ws, GU, 'V4', key(), {}, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((x: string) => /2 case\(s\) in 1 group\(s\) reached the modern side as the same input/.test(x)), v['reasons'].join('; '))
  })
  test('the same input on both sides is not ambiguous', () => {
    setupDigests([[310, 'same', 'm-same'], [311, 'same', 'm-same']])
    assert.deepEqual([...P.allRuns(ws)][0]!['coverage']['ambiguous_inputs'], [])
    assert.equal(P.verdict(ws, GU, 'V4', key(), {}, false)['verdict'], 'PROVEN')
  })
  test('with input_digests required, a compared case without digests on both sides is a gap', () => {
    setupDigests([[320, 'x', 'y']])
    const v = P.verdict(ws, GU, 'V4', key(), { input_digests: true }, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((x: string) => /20 case\(s\) were compared without an input_digest on both sides/.test(x)), v['reasons'].join('; '))
  })
  test('input_digest is never compared and must be a string', () => {
    assert.ok(P.exactCompare(dobs('A', 'x'), dobs('A', 'y'), 'INTCALC').equal)
    assert.match(P.observationProblem({ ...obs('A'), input_digest: 5 })!, /input_digest/)
  })
})

describe('round 2 items 30-32: reports that say what they mean', () => {
  test('30: an exhaustive class whose whole domain is sealed is listed apart, and the note never asks for its inputs', () => {
    // 20 cases in executable mode: the 20-case minimum seals every one, so no class has a dev case.
    const pool = Array.from({ length: 19 }, (_, i) => add(i, ['ok']))
    const empty = add(700, ['structural:empty'])
    writeFileSync(join(dir, 'pool.txt'), [...pool, empty].join('\n'))
    writeFileSync(join(dir, 'req.json'), JSON.stringify({ ok: 'ok', 'structural:empty': 'the one empty file' }))
    const log = console.log
    let out = ''
    console.log = (x: string) => { out = x }
    try {
      P.main(['set', 'build', '--ws', dir, '--system', 'cd', '--set', 'S', '--gate-unit', GU, '--mode', 'executable',
        '--pool', `@${join(dir, 'pool.txt')}`, '--required', join(dir, 'req.json'), '--exhaustive', 'structural:empty'])
    } finally { console.log = log }
    const j = JSON.parse(out)
    assert.equal(j['sealed'], 20)
    assert.deepEqual(j['classes_without_dev'], ['ok'])
    assert.deepEqual(j['exhaustive_without_dev'], ['structural:empty'])
    assert.match(j['note'], /classes_without_dev .*Add new inputs/)
    assert.match(j['note'], /exhaustive_without_dev .*cannot/)
  })
  test('31: run.json always records not_run, ambiguous_inputs, class_unreached and timing, empty when nothing happened', () => {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const o = observe('r1', pool)
    const r = P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    assert.equal(r['not_run'], 0)
    const c = [...P.allRuns(ws)][0]!['coverage']
    assert.deepEqual(c['not_run'], {})
    assert.deepEqual(c['ambiguous_inputs'], [])
    assert.deepEqual(c['class_unreached'], {})
    assert.deepEqual(c['timing'], { cases: 0, legacy_ms: 0, modern_ms: 0, modern_max_ms: 0 })
    assert.equal(P.verdict(ws, GU, 'V4', key(), {}, false)['verdict'], 'PROVEN')
  })
  test('32: verify.md: class_observables ids join the requirements; a .ts comparator example', () => {
    const v = readFileSync(new URL('../../plugins/rig/commands/verify.md', import.meta.url), 'utf8')
    assert.match(v, /every id the set's `class_observables` names/)
    assert.match(readFileSync(new URL('../../plugins/rig/commands/judge.md', import.meta.url), 'utf8'), /--comparator "node oracles\/\$system\/comparators\/<name>\.ts"/)
  })
})

describe('round 2 item 24: V7 reconciliation of one dataset can be proven, and its key hashes the harness', () => {
  const recon = () => {
    const id = add(900, ['migration:CUSTFILE'])
    const s = P.buildSet(ws, 'V7', GU, 'reconcile', [id], { 'migration:CUSTFILE': 'the one dataset' }, {})
    return { id, s }
  }
  const harness = () => { mkdirSync(join(dir, 'harness'), { recursive: true }); writeFileSync(join(dir, 'harness', 'CUSTUNLD.cbl'), 'UNLOAD.'); return ['harness/CUSTUNLD.cbl'] }
  const k7 = (h = harness()) => P.evidenceKey(ws, GU, 'V7', join(dir, 'legacy'), ['modern/Intcalc.java'], 'V7', [], {}, {}, h)['key'] as string
  test('reconcile mode takes one case and seals it', () => {
    const { id, s } = recon()
    assert.deepEqual(s['sealed'], [id])
    assert.deepEqual(s['dev'], [])
  })
  test('a passing reconciliation is PROVEN at V7, and refused at any other rung', () => {
    const { id } = recon()
    const o = observe('r1', [id])
    const k = k7()
    P.judge(ws, 'V7', k, o.l, o.m, [], undefined, [], 'env')
    const v = P.verdict(ws, GU, 'V7', k, {}, false)
    assert.equal(v['verdict'], 'PROVEN', v['reasons'].join('; '))
    const v3 = P.verdict(ws, GU, 'V3', k, {}, false)
    assert.equal(v3['verdict'], 'NOT_PROVEN')
    assert.ok(v3['reasons'].some((x: string) => /reconcile.*V7 only/.test(x)), v3['reasons'].join('; '))
  })
  test('every reconciliation case needs a live legacy observation', () => {
    const { id } = recon()
    const o = observe('r1', [id])
    rmSync(join(o.l, `${id}.json`))
    assert.throws(() => P.judge(ws, 'V7', k7(), o.l, o.m, [], undefined, [], 'env'), /no legacy observation/)
  })
  test('a failed reconciliation can be rerun without fresh inputs (the dataset is the domain), and the failure stays', () => {
    const { id } = recon()
    const k = k7()
    const o = observe('r1', [id], [id])
    P.judge(ws, 'V7', k, o.l, o.m, [], undefined, [], 'env')
    const o2 = observe('r2', [id])
    P.judge(ws, 'V7', k, o2.l, o2.m, [], undefined, [], 'env')
    assert.equal(P.verdict(ws, GU, 'V7', k, {}, false)['verdict'], 'FLAKY')
  })
  test('a V7 key needs --harness, and changes with a harness file', () => {
    assert.throws(() => P.evidenceKey(ws, GU, 'V7', join(dir, 'legacy'), ['modern/Intcalc.java'], undefined, [], {}, {}), /--harness/)
    const a = k7()
    writeFileSync(join(dir, 'harness', 'CUSTUNLD.cbl'), 'UNLOAD CHANGED.')
    assert.notEqual(k7(['harness/CUSTUNLD.cbl']), a)
  })
  test('without --harness, keys of other rungs are what they were', () => {
    const before = P.evidenceKey(ws, GU, 'V3', join(dir, 'legacy'), ['modern/Intcalc.java'], undefined, [], {}, {})['key']
    assert.equal(P.evidenceKey(ws, GU, 'V3', join(dir, 'legacy'), ['modern/Intcalc.java'], undefined, [], {}, {}, [])['key'], before)
    assert.notEqual(P.evidenceKey(ws, GU, 'V3', join(dir, 'legacy'), ['modern/Intcalc.java'], undefined, [], {}, {}, harness())['key'], before)
  })
})

describe('round 2 item 29 (owner decision): who has seen judge outcomes may not then edit modernized/', () => {
  test('decide: after seeing the judge, a write to modernized/ is denied; before, it is allowed', async () => {
    const G = await import('../../plugins/rig/hooks/guard.ts')
    const w = { tool_name: 'Edit', tool_input: { file_path: '/ws/modernized/app/Run.ts' }, cwd: '/ws' }
    assert.equal(G.decide(w, '/ws', false), null)
    assert.match(G.decide(w, '/ws', true) ?? '', /has seen judge outcomes/)
    assert.match(G.decide({ tool_name: 'Bash', tool_input: { command: 'echo x > modernized/app/x.txt' }, cwd: '/ws' }, '/ws', true) ?? '', /has seen judge outcomes/)
    assert.equal(G.decide({ tool_name: 'Write', tool_input: { file_path: '/ws/work/sys/ENG.md' }, cwd: '/ws' }, '/ws', true), null, 'reports are still allowed')
  })
  test('seesJudge: running the judge or reading judge observations or evidence marks the caller', async () => {
    const G = await import('../../plugins/rig/hooks/guard.ts')
    const at = (tool: string, input: object) => G.seesJudge({ tool_name: tool, tool_input: input, cwd: '/ws' }, '/ws')
    assert.ok(at('Bash', { command: 'node /p/scripts/rig_proof.ts judge --ws . --system s --set S --key K' }))
    assert.ok(at('Read', { file_path: '/ws/work/sys/judge/obs/r1/modern/abc.json' }))
    assert.ok(at('Read', { file_path: '/ws/evidence/sys/K/r/run.json' }))
    assert.ok(at('Bash', { command: 'cat work/sys/judge/obs/r1/legacy/a.json' }))
    assert.ok(!at('Bash', { command: 'node /p/scripts/rig_proof.ts verdict --ws . --system s --gate-unit job:X --rung V3 --key K' }), 'the verdict prints no case outcome')
    assert.ok(!at('Read', { file_path: '/ws/modernized/app/Run.ts' }))
  })
  test('the hook keeps the mark per session and agent: the judge subagent is marked, the main session is not', () => {
    const root = mkdtempSync(join(tmpdir(), 'rig-guard-'))
    const G = fileURLToPath(new URL('../../plugins/rig/hooks/guard.ts', import.meta.url))
    const run = (inp: object) => spawnSync(process.execPath, [G], { input: JSON.stringify({ cwd: root, ...inp }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } }).stdout
    try {
      const edit = { tool_name: 'Edit', tool_input: { file_path: join(root, 'modernized/a.ts') } }
      assert.equal(run({ session_id: 's1', ...edit }), '', 'main session edits before any judge')
      run({ session_id: 's1', agent_id: 'j1', agent_type: 'rig:judge', tool_name: 'Bash', tool_input: { command: 'node /p/rig_proof.ts judge --set S' } })
      assert.equal(run({ session_id: 's1', ...edit }), '', 'the judge subagent ran it, not the main session')
      assert.match(run({ session_id: 's1', agent_id: 'j1', agent_type: 'rig:judge', ...edit }), /deny/)
      run({ session_id: 's1', tool_name: 'Read', tool_input: { file_path: join(root, 'work/sys/judge/obs/r/m/a.json') } })
      assert.match(run({ session_id: 's1', ...edit }), /has seen judge outcomes/)
      assert.equal(run({ session_id: 's2', ...edit }), '', 'another session is not marked')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

describe('owner decision V9: an absolute budget per run (timing_max_ms)', () => {
  const timedObs = (ms: number) => ({ ...obs('A'), elapsed_ms: ms })
  function run(lms: number, mms: number[]) {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const l = join(dir, 'obs', 'r1', 'l'), m = join(dir, 'obs', 'r1', 'm')
    mkdirSync(l, { recursive: true }); mkdirSync(m, { recursive: true })
    pool.forEach((id, i) => { writeFileSync(join(l, `${id}.json`), JSON.stringify(timedObs(lms))); writeFileSync(join(m, `${id}.json`), JSON.stringify(timedObs(mms[i % mms.length]!))) })
    P.judge(ws, 'S', key(), l, m, [], undefined, [], 'env')
  }
  test('the slowest modern run is recorded', () => {
    run(4, [860, 974, 647])
    assert.equal([...P.allRuns(ws)][0]!['coverage']['timing']['modern_max_ms'], 974)
  })
  test('within the budget the timing passes, although the ratio is about 200x; over it, a gap names the slowest run', () => {
    run(4, [860, 974, 647])
    const req = { observables: ['INTCALC.timing'], timing_max_ms: 2000 }
    assert.equal(P.verdict(ws, GU, 'V4', key(), req, false)['verdict'], 'PROVEN')
    const tight = P.verdict(ws, GU, 'V4', key(), { ...req, timing_max_ms: 900 }, false)
    assert.equal(tight['verdict'], 'NOT_PROVEN')
    assert.ok(tight['reasons'].some((x: string) => /974 ms.*budget is 900 ms/.test(x)), tight['reasons'].join('; '))
  })
  test('with both limits, both apply', () => {
    run(4, [860])
    const v = P.verdict(ws, GU, 'V4', key(), { observables: ['INTCALC.timing'], timing_max_ms: 2000, timing_max_ratio: 2 }, false)
    assert.ok(v['reasons'].some((x: string) => /x legacy/.test(x)))
  })
  test('a run recorded before timing_max_ms existed is a gap that says so, not "Infinity ms"', () => {
    run(4, [860])
    const rp = join(ws.evidence, key(), readdirSync(join(ws.evidence, key()))[0]!, 'run.json')
    const r = P.load(rp); delete r['coverage']['timing']['modern_max_ms']; writeFileSync(rp, JSON.stringify(r))
    const v = P.verdict(ws, GU, 'V4', key(), { timing_max_ms: 2000 }, false)
    assert.ok(v['reasons'].some((x: string) => /predates timing_max_ms/.test(x)), v['reasons'].join('; '))
  })
  test('a budget with no timed run is a gap', () => {
    const pool = Array.from({ length: 20 }, (_, i) => add(i, ['ok']))
    P.buildSet(ws, 'S', GU, 'executable', pool, { ok: 'ok' }, {})
    const o = observe('r1', pool)
    P.judge(ws, 'S', key(), o.l, o.m, [], undefined, [], 'env')
    const v = P.verdict(ws, GU, 'V4', key(), { timing_max_ms: 2000 }, false)
    assert.ok(v['reasons'].some((x: string) => /no run recorded elapsed_ms on both sides/.test(x)), v['reasons'].join('; '))
  })
})
