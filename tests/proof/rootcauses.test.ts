/**
 * Regression tests for rig_proof.ts: every interrogation root cause the proof core owns.
 *
 * Each block names the root cause (INTERROGATION.md = round 1, INTERROGATION-2.md = round 2) and the repro scripts
 * under tests/repros/ whose attack it replays. Run:
 *
 *     node --test tests/proof/
 *
 * Root causes owned by commands rather than this script are listed at the bottom.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import * as P from '../../plugins/rig/scripts/rig_proof.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const UNIT = 'INTJOB'
const GU = 'job:INTJOB'

type Obj = Record<string, any>

const inp = (o: { records?: Obj; clock?: string; params?: Obj; stores?: Obj } = {}) =>
  ({ records: o.records ?? {}, params: o.params ?? {}, clock: o.clock ?? '2026-11-09T02:00:00', stores: o.stores ?? {}, session: null })

const obs = (rows: Obj[], store = 'ACCTFILE', rc = 0) => ({ stores: { [store]: { records: rows } }, return_code: rc, abend: null })

/** A fresh workspace under tests/runs/ (git-ignored), removed after each test. */
class Ws {
  dir = ''
  ws!: P.WS
  open() {
    mkdirSync(join(ROOT, 'tests', 'runs'), { recursive: true })
    this.dir = mkdtempSync(join(ROOT, 'tests', 'runs', 'proof-test-'))
    this.ws = new P.WS(this.dir, 'sys')
    for (const d of ['legacy', 'L', 'M']) mkdirSync(join(this.dir, d))
  }
  close() { rmSync(this.dir, { recursive: true, force: true }) }
  case(n: number, classes: string[] = ['random'], expected: Obj | null = null, o: { clock?: string } = {}) {
    return P.addCase(this.ws, inp({ records: { IN: [{ n: String(n) }] }, ...o }), classes, 'random', expected)['id'] as string
  }
  pool(n: number, classes: string[] = ['random'], o: { clock?: string } = {}) {
    return Array.from({ length: n }, (_, i) => this.case(i, classes, null, o))
  }
  observe(id: string, legacy: Obj, modern: Obj) {
    P.dump(join(this.dir, 'L', `${id}.json`), legacy)
    P.dump(join(this.dir, 'M', `${id}.json`), modern)
  }
  judge(set: string, o: { key?: string; fresh?: string[]; env?: string; comparator?: string } = {}) {
    return P.judge(this.ws, set, o.key ?? 'K1', join(this.dir, 'L'), join(this.dir, 'M'), o.fresh ?? [], o.comparator, [], o.env ?? 'ref-a')
  }
  surface(complete: boolean, o: { internal?: string[]; external?: Obj[]; type?: string } = {}) {
    const s = { gate_unit: GU, observables: [{ id: `${UNIT}/ACCTFILE.record_order`, kind: 'record_order', type: o.type ?? 'decimal(9,2)',
      consumers: { internal: o.internal ?? [], external: o.external ?? [], complete } }] }
    P.dump(join(this.dir, 'analysis/sys/surfaces/job-INTJOB.json'), s)
    return 'analysis/sys/surfaces/job-INTJOB.json'
  }
  clearFailed(set: string) { P.dump(this.ws.setPath(set), { ...P.load(this.ws.setPath(set)), failed_classes: [] }) }
}

const t = new Ws()
beforeEach(() => t.open())
afterEach(() => t.close())

// ---------------------------------------------------------------------------
// Round 2 #1 (round 1 #3): normalizers erase what consumers need
// repros: round2/adv-1/f2_normalizer_external.py, adv-2/f1_external_consumer_normalizer.py,
//         adv-3/g_external_consumer_normalizer.py, round1/adv-1/p5_canonicalize_context.py
// ---------------------------------------------------------------------------
describe('normalizers and consumers', () => {
  const norm = (surface: string, extra: Obj = {}) =>
    ({ id: 'NORM-012', observable: `${UNIT}/ACCTFILE.record_order`, erases: 'order', surface, approved_by: 'a person', ...extra })

  test('an empty consumer list is unknown and forbids erasure', () => {
    assert.ok(P.checkNormalizer(t.ws, norm(t.surface(false))).some((e) => e.includes('not complete')))
  })
  test('an external consumer that depends on order forbids erasure', () => {
    const s = t.surface(true, { external: [{ name: 'GL bureau', depends_on: ['record_order'], attested_by: 'x' }] })
    assert.ok(P.checkNormalizer(t.ws, norm(s)).some((e) => e.includes('GL bureau')))
  })
  test('an internal consumer without cited evidence forbids erasure', () => {
    assert.ok(P.checkNormalizer(t.ws, norm(t.surface(true, { internal: ['program:REPT01'] }))).some((e) => e.includes('REPT01')))
  })
  test('legal only with a complete list and evidence for every consumer', () => {
    const n = norm(t.surface(true, { internal: ['program:STEP2'] }), { consumer_evidence: { 'program:STEP2': 'app/cbl/STEP2.cbl:88 SORT on read' } })
    assert.deepEqual(P.checkNormalizer(t.ws, n), [])
  })
  test('an unapproved normalizer is illegal', () => {
    const n: Obj = norm(t.surface(true))
    delete n['approved_by']
    assert.ok(P.checkNormalizer(t.ws, n).some((e) => e.includes('approval')))
  })
  test('a decimal takes no tolerance', () => {
    const n = { observable: `${UNIT}/ACCTFILE.record_order`, erases: 'tolerance', surface: t.surface(true), approved_by: 'x' }
    assert.ok(P.checkNormalizer(t.ws, n).length > 0)
  })
  test('an encoding normalizer must round-trip', () => {
    const n = { observable: `${UNIT}/ACCTFILE.record_order`, erases: 'encoding', encoding: 'cp037', surface: t.surface(true), approved_by: 'x' }
    assert.deepEqual(P.checkNormalizer(t.ws, n), [])
    assert.ok(P.checkNormalizer(t.ws, { ...n, encoding: 'ascii-lossy' }).length > 0)
  })
})

// ---------------------------------------------------------------------------
// Round 2 #2: the gate unit pulled in most of the system
// repros: round2/adv-1/f1_gate_unit.py, adv-2/f2_gate_unit.py, adv-3/d_gate_unit.py
// ---------------------------------------------------------------------------
test('the runtime closure stops at persistent stores', () => {
  P.dump(join(t.ws.analysis, 'graph.json'), {
    nodes: [{ id: 'job:INTJOB', loc: 'jcl/INTJOB.jcl:1' }, { id: 'step:INTJOB/S1', loc: 'jcl/INTJOB.jcl:3' },
      { id: 'program:CBACT04C', loc: 'cbl/CBACT04C.cbl:1' }, { id: 'dataset:ACCT', loc: null },
      { id: 'program:READER', loc: 'cbl/READER.cbl:1' }, { id: 'job:OTHER', loc: 'jcl/OTHER.jcl:1' }],
    edges: [{ from: 'job:INTJOB', to: 'step:INTJOB/S1', kind: 'contains' }, { from: 'step:INTJOB/S1', to: 'program:CBACT04C', kind: 'runs' },
      { from: 'step:INTJOB/S1', to: 'dataset:ACCT', kind: 'writes' }, { from: 'job:OTHER', to: 'program:READER', kind: 'contains' },
      { from: 'program:READER', to: 'dataset:ACCT', kind: 'reads' }],
  })
  const closure = P.runtimeClosure(t.ws, GU)
  assert.ok(closure.includes('cbl/CBACT04C.cbl'))
  assert.ok(!closure.includes('cbl/READER.cbl'))
  assert.ok(!closure.includes('jcl/OTHER.jcl'))
})

// ---------------------------------------------------------------------------
// Round 2 #3 (round 1 #1): single-value canaries miss structural and representation bugs
// repros: round2/adv-1/f3_canary_sweep.py, adv-2/f3_canary_sweep.py, adv-3/a_canary_sweep.py, round1/adv-1/p3_delta_comparator.py
// ---------------------------------------------------------------------------
const WEAK: Record<string, string> = {
  zip: `const [a, b] = process.argv.slice(2).map((p) => JSON.parse(require('fs').readFileSync(p, 'utf8')))
const ra = a.stores.STMT.records, rb = b.stores.STMT.records
const eq = ra.every((x, i) => i >= rb.length || JSON.stringify(x) === JSON.stringify(rb[i])) && a.return_code === b.return_code && a.abend === b.abend
console.log(JSON.stringify({ equal: eq, compared: ['STMT.field:*'] }))`,
  columns: `const [a, b] = process.argv.slice(2).map((p) => JSON.parse(require('fs').readFileSync(p, 'utf8')))
const ra = a.stores.STMT.records, rb = b.stores.STMT.records
const cols = (r) => JSON.stringify(Object.keys(r[0] || {}).sort().map((k) => r.map((x) => String(x[k])).sort()))
const eq = ra.length === rb.length && cols(ra) === cols(rb) && a.return_code === b.return_code && a.abend === b.abend
console.log(JSON.stringify({ equal: eq, compared: ['STMT.field:*'] }))`,
  abs: `const [a, b] = process.argv.slice(2).map((p) => JSON.parse(require('fs').readFileSync(p, 'utf8')))
const norm = (r) => JSON.stringify(r.map((x) => ({ ...x, amount: x.amount == null ? x.amount : x.amount.replace(/^-/, '') })))
const eq = norm(a.stores.STMT.records) === norm(b.stores.STMT.records) && a.return_code === b.return_code && a.abend === b.abend
console.log(JSON.stringify({ equal: eq, compared: ['STMT.field:*'] }))`,
  lines: `const [a, b] = process.argv.slice(2).map((p) => JSON.parse(require('fs').readFileSync(p, 'utf8')))
const set = (m) => JSON.stringify([...new Set(m || [])].sort())
console.log(JSON.stringify({ equal: set(a.messages) === set(b.messages) && a.return_code === b.return_code && a.abend === b.abend, compared: ['READCUST.message'] }))`,
}

const SAMPLE = { stores: { STMT: { records: [
  { account: '00000012345', date: '2026-10-11', amount: '-42.10', desc: 'FUEL' },
  { account: '00000012345', date: '2026-10-31', amount: '17.00', desc: 'SHOP' }] } }, return_code: 0, abend: null }

const SYSOUT = { stores: {}, return_code: 0, abend: null, messages: [
  'START OF EXECUTION OF PROGRAM CBCUS01C', '000000001Immanuel  ', '000000001Immanuel  ', 'END OF EXECUTION OF PROGRAM CBCUS01C'] }

describe('canary sweep', () => {
  const weak = (name: string) => {
    const p = join(t.dir, `${name}.cjs`)
    writeFileSync(p, WEAK[name]!)
    return `${process.execPath} ${p}`
  }
  const sweep = (cmp: string, sample: Obj = SAMPLE) => P.canarySweep([sample], cmp, 'STMTJOB', [], join(t.dir, 'tmp'))

  test('a zip comparator is not trusted', () => {
    const r = sweep(weak('zip'))
    assert.equal(r['trusted'], false)
    assert.ok(r['missed'].some((m: string) => m.includes('delete last record')))
  })
  test('a column comparator is not trusted', () => {
    const r = sweep(weak('columns'))
    assert.equal(r['trusted'], false)
    assert.ok(r['missed'].some((m: string) => m.includes('swap') || m.includes('reorder')), r['missed'].join('\n'))
  })
  test('an abs comparator is not trusted', () => {
    const r = sweep(weak('abs'))
    assert.equal(r['trusted'], false)
    assert.ok(r['missed'].some((m: string) => m.includes('negate')))
  })
  test('the exact comparator catches every canary', () => {
    const r = sweep('exact')
    assert.equal(r['trusted'], true, r['missed'].join('\n'))
    for (const cls of ['structural', 'value', 'sign_zero', 'representation']) assert.ok(r['classes'].includes(cls))
  })
  test('lost leading zeros are a difference', () => {
    const modern = structuredClone(SAMPLE)
    modern.stores.STMT.records[0]!.account = '12345'
    assert.equal(P.exactCompare(SAMPLE, modern, 'STMTJOB').equal, false)
  })
  test('a sample too small for structural canaries is not trusted', () => {
    const one = { stores: { STMT: { records: [SAMPLE.stores.STMT.records[0]] } }, return_code: 0, abend: null }
    assert.equal(sweep('exact', one)['trusted'], false)
  })
  // M2 exit run: READCUST's only real output is SYSOUT, and the sweep had no message canaries.
  test('message canaries: exact is trusted on SYSOUT, a set-of-lines comparator is not', () => {
    const exact = sweep('exact', SYSOUT)
    assert.equal(exact['trusted'], true, exact['missed'].join('\n'))
    const weakR = sweep(weak('lines'), SYSOUT)
    assert.equal(weakR['trusted'], false)
    assert.ok(weakR['missed'].some((m: string) => m.includes('messages: duplicate') || m.includes('messages: reorder')))
  })
})

// ---------------------------------------------------------------------------
// Round 1 #1 (round 2 #3, #8): a delta hides undeclared differences, or loses obligations
// repro: round1/adv-1/p3_delta_comparator.py, round2/adv-3/e_obligation_deadlock.py
// ---------------------------------------------------------------------------
describe('delta totality', () => {
  test('unmapped observables fail the delta', () => {
    const errs = P.checkDelta(t.ws, { map: { 'STMT.field:amount': '$.lines[*].amount' }, removed: [], added: [], approved_by: 'x' },
      ['STMT.field:amount', 'STMT.record_order', 'STMT.cardinality'], ['$.lines[*].amount', '$.links.self'])
    for (const k of ['record_order', 'cardinality', '$.links.self']) assert.ok(errs.some((e) => e.includes(k)), k)
  })
  test('a delta must map open obligations', () => {
    P.dump(join(t.ws.obligations, 'OBL-1.json'), { id: 'OBL-1', observables: ['STMT.field:amount'], requirement: 'hazard:invalid_packed', status: 'open' })
    const d: Obj = { map: { 'STMT.field:amount': '$.amount' }, approved_by: 'x' }
    assert.ok(P.checkDelta(t.ws, d, ['STMT.field:amount'], ['$.amount']).some((e) => e.includes('OBL-1')))
    d['obligations_map'] = { 'OBL-1': ['module:statements'] }
    assert.deepEqual(P.checkDelta(t.ws, d, ['STMT.field:amount'], ['$.amount']), [])
  })
})

// ---------------------------------------------------------------------------
// Round 2 #4 (round 1 #9): seeds in the key, and reruns that clear failures
// repros: round2/adv-1/f4_flaky_key.py, adv-2/f6_flaky.py, adv-3/b_key_seed_flaky.py, round1/adv-1/p8_stale_evidence.py
// ---------------------------------------------------------------------------
describe('reruns never clear a failure', () => {
  let ids: string[]
  const row = [{ n: '1' }, { n: '2' }]
  const allPass = () => ids.forEach((c) => t.observe(c, obs(row), obs(row)))
  beforeEach(() => {
    ids = t.pool(24)
    P.buildSet(t.ws, 'S', GU, 'executable', ids, { random: 'uniform records' }, { random: 'def v1' })
  })

  test('a failure stays after any number of passing reruns', () => {
    allPass()
    t.observe(ids[3]!, obs(row), obs([{ n: '1' }]))
    t.judge('S')
    allPass()
    for (let i = 0; i < 10; i++) { t.clearFailed('S'); t.judge('S') }
    assert.equal(P.verdict(t.ws, GU, 'V3', 'K1', {}, false)['verdict'], 'FLAKY')
  })
  test('a deterministic failure is not proven', () => {
    allPass()
    t.observe(ids[0]!, obs(row), obs([{ n: '9' }]))
    t.judge('S')
    assert.equal(P.verdict(t.ws, GU, 'V3', 'K1', {}, false)['verdict'], 'NOT_PROVEN')
  })
  test('an infrastructure sign-off needs two environments and a signature', () => {
    allPass()
    t.observe(ids[0]!, obs(row), obs([{ n: '9' }]))
    t.judge('S', { env: 'ref-a' })
    allPass()
    t.clearFailed('S')
    t.judge('S', { env: 'ref-b' })
    P.dump(join(t.ws.evidence, 'signoffs', 's.json'), { case: ids[0], signed_by: 'ops lead' })
    assert.equal(P.verdict(t.ws, GU, 'V3', 'K1', {}, false)['verdict'], 'PROVEN')
  })
  test('seeds are not in the key', () => {
    const h1 = P.setHash(P.load(t.ws.setPath('S')))
    allPass()
    t.judge('S')
    assert.equal(h1, P.setHash(P.load(t.ws.setPath('S'))))
  })
  test('zero cases is not proven', () => {
    P.dump(join(t.ws.evidence, 'K0', 'r', 'run.json'), { run_id: 'r', key: 'K0', gate_unit: GU, mode: 'executable', environment: 'x', results: [],
      coverage: { observables: {}, classes: {}, hazards: {}, calendar_events: [], mismatches: [] } })
    assert.equal(P.verdict(t.ws, GU, 'V3', 'K0', {}, false)['verdict'], 'NOT_PROVEN')
  })
  // M2 exit run: failing fresh inputs join the sealed set, the key changes, and "no runs" hid the failure.
  test('a stale key still reports the failures found under the previous key', () => {
    allPass()
    const f = t.case(99)
    t.observe(f, obs(row), obs([{ n: '9' }]))
    t.judge('S', { fresh: [f] })
    const v = P.verdict(t.ws, GU, 'V3', 'K-NEW', {}, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((r: string) => r.includes('1 of 25 case(s) failed')), v['reasons'].join('\n'))
  })
})

// ---------------------------------------------------------------------------
// Round 2 #5 (round 1 #9): the key missed job wiring and legacy JCL
// repro: round2/adv-2/f7_evidence_key.py
// ---------------------------------------------------------------------------
describe('evidence key', () => {
  const modern = ['modernized/batch/intjob.xml', 'modernized/StmtStep.java']
  beforeEach(() => {
    const files: Obj = { 'legacy/jcl/INTJOB.jcl': '//S1 EXEC PGM=A', 'legacy/cbl/A.cbl': 'A', 'legacy/cbl/B.cbl': 'B',
      'modernized/batch/intjob.xml': '<job/>', 'modernized/StmtStep.java': 'class S{}' }
    for (const [p, txt] of Object.entries(files)) { mkdirSync(join(t.dir, p, '..'), { recursive: true }); writeFileSync(join(t.dir, p), txt) }
    P.dump(join(t.ws.analysis, 'graph.json'), {
      nodes: [{ id: 'job:INTJOB', loc: 'jcl/INTJOB.jcl:1' }, { id: 'step:INTJOB/S1', loc: 'jcl/INTJOB.jcl:1' }, { id: 'step:INTJOB/S2', loc: 'jcl/INTJOB.jcl:2' },
        { id: 'program:A', loc: 'cbl/A.cbl:1' }, { id: 'program:B', loc: 'cbl/B.cbl:1' }],
      edges: [{ from: 'job:INTJOB', to: 'step:INTJOB/S1', kind: 'contains' }, { from: 'job:INTJOB', to: 'step:INTJOB/S2', kind: 'contains' },
        { from: 'step:INTJOB/S1', to: 'program:A', kind: 'runs' }, { from: 'step:INTJOB/S2', to: 'program:B', kind: 'runs' }],
    })
  })
  const key = (env: Obj = { collation: 'EBCDIC' }, comparators: string[] = []) =>
    P.evidenceKey(t.ws, GU, 'V3', join(t.dir, 'legacy'), modern, undefined, comparators, { 'cobol-zos': '1' }, env)['key']

  test('editing any step, the wiring or the JCL changes the key', () => {
    for (const p of ['legacy/cbl/B.cbl', 'legacy/jcl/INTJOB.jcl', 'modernized/batch/intjob.xml', 'modernized/StmtStep.java']) {
      const before = key()
      writeFileSync(join(t.dir, p), 'edited')
      assert.notEqual(before, key(), p)
    }
  })
  test('the environment holds semantic settings only', () => {
    assert.equal(key({ collation: 'EBCDIC' }), key({ collation: 'EBCDIC' }))
    assert.notEqual(key({ collation: 'EBCDIC' }), key({ collation: 'ASCII' }))
  })
  test('a new consumer invalidates normalizer evidence', () => {
    const s = t.surface(true, { internal: ['program:STEP2'] })
    P.dump(join(t.dir, 'oracles/sys/normalizers/NORM-1.json'), { surface: s, erases: 'order' })
    const k1 = key(undefined, ['oracles/sys/normalizers/NORM-1.json'])
    t.surface(true, { internal: ['program:STEP2', 'program:NEWREADER'] })
    assert.notEqual(k1, key(undefined, ['oracles/sys/normalizers/NORM-1.json']))
  })
})

// ---------------------------------------------------------------------------
// Round 2 #6 (round 1 #7): no oracle supply when legacy cannot run
// repros: round2/adv-2/f5_recorded_only_starve.py, adv-1/f8_sealed_burn.py, round1/adv-1/p6_policy_deadlock.py
// ---------------------------------------------------------------------------
describe('recorded mode', () => {
  test('reaches PROVISIONAL with accepted obligations, never PROVEN', () => {
    const row = [{ n: '1' }, { n: '2' }]
    const ids = Array.from({ length: 8 }, (_, i) => t.case(i, ['random'], obs(row)))
    assert.equal(P.buildSet(t.ws, 'R', GU, 'recorded', ids, { random: 'recorded traffic' }, {})['sealed'].length, 2)
    for (const c of ids) P.dump(join(t.dir, 'M', `${c}.json`), obs(row))
    t.judge('R')
    const req = { hazards: ['rounded'] }
    assert.equal(P.verdict(t.ws, GU, 'V3', 'K1', req, true)['verdict'], 'NOT_PROVEN')
    for (const f of readdirSync(t.ws.obligations)) P.dump(join(t.ws.obligations, f), { ...P.load(join(t.ws.obligations, f)), accepted_by: 'a person' })
    assert.equal(P.verdict(t.ws, GU, 'V3', 'K1', req, false)['verdict'], 'PROVISIONAL')
    assert.equal(P.verdict(t.ws, GU, 'V3', 'K1', {}, false)['verdict'], 'PROVISIONAL')
  })
  // M2 exit run: an abend on a generated input with no recording was counted as a failure.
  test('a generated input with no recording passes on an abend and fails only on a crash', () => {
    const row = [{ n: '1' }, { n: '2' }]
    const ids = Array.from({ length: 4 }, (_, i) => t.case(i, ['random'], obs(row)))
    P.buildSet(t.ws, 'R', GU, 'recorded', ids, {}, {})
    for (const c of ids) P.dump(join(t.dir, 'M', `${c}.json`), obs(row))
    const g1 = t.case(50, ['abend:open_failure'])
    const g2 = t.case(51, ['abend:open_failure'])
    P.dump(join(t.dir, 'M', `${g1}.json`), { ...obs([]), abend: 'U999', return_code: null })
    P.dump(join(t.dir, 'M', `${g2}.json`), { ...obs([]), crash: 'NullPointerException' })
    const out = t.judge('R', { fresh: [g1, g2] })
    assert.deepEqual(out['classes'].find((c: Obj) => c.class === 'abend:open_failure'), { class: 'abend:open_failure', description: '', passed: 1, total: 2 })
  })
  test('executable mode requires a real sealed set', () => {
    assert.throws(() => P.buildSet(t.ws, 'E', GU, 'executable', t.pool(10), {}, {}), P.Bad)
  })
})

// ---------------------------------------------------------------------------
// Round 2 #7 (round 1 #2): revealed sealed cases were patched and the sealed set drained
// repros: round2/adv-2/f4_patch_revealed_case.py, adv-3/c_burn_starve.py, round1/adv-1/p1_heldout_leak.py
// ---------------------------------------------------------------------------
describe('sealed set and judge', () => {
  let ids: string[]
  beforeEach(() => {
    ids = t.pool(24)
    P.buildSet(t.ws, 'S', GU, 'executable', ids, { random: 'uniform records' }, { random: 'def' })
    for (const c of ids) t.observe(c, obs([{ v: '1' }]), obs([{ v: '1' }]))
  })

  test('judge output holds counts and descriptions only', () => {
    t.observe(ids[5]!, obs([{ v: 'SECRET-EXPECTED' }]), obs([{ v: 'SECRET-ACTUAL' }]))
    const out = JSON.stringify(t.judge('S'))
    assert.ok(!out.includes('SECRET'))
    for (const c of ids) assert.ok(!out.includes(c))
    assert.ok(out.includes('uniform records'))
  })
  test('sealed cases never move, and failing fresh inputs join them', () => {
    const sealed = new Set<string>(P.load(t.ws.setPath('S'))['sealed'])
    const f = t.case(99)
    t.observe(f, obs([{ v: '1' }]), obs([{ v: '2' }]))
    t.judge('S', { fresh: [f] })
    const s = P.load(t.ws.setPath('S'))
    for (const c of sealed) assert.ok(s['sealed'].includes(c))
    assert.ok(s['sealed'].includes(f))
    assert.ok(!s['dev'].includes(f))
  })
  test('a failed class must return with fresh inputs', () => {
    t.observe(ids[0]!, obs([{ v: '1' }]), obs([{ v: '2' }]))
    t.judge('S')
    assert.throws(() => t.judge('S'), P.Bad)
  })
  // M2 exit run: structural:empty has one possible input, so it can never be fresh again.
  test('an exhaustive class is exempt from the fresh-input rules', () => {
    const e = t.case(77, ['structural:empty'])
    P.buildSet(t.ws, 'S', GU, 'executable', [e], { 'structural:empty': 'the empty file' }, {}, ['structural:empty'])
    t.observe(e, obs([{ v: '1' }]), obs([]))
    t.judge('S')
    t.observe(e, obs([{ v: '1' }]), obs([{ v: '1' }]))
    assert.doesNotThrow(() => t.judge('S'))
    assert.equal(P.verdict(t.ws, GU, 'V4', 'K1', { fresh_classes: ['structural:empty'] }, false)['verdict'], 'FLAKY')
  })
  test('memorised cases without fresh inputs leave a gap', () => {
    t.judge('S')
    assert.equal(P.verdict(t.ws, GU, 'V4', 'K1', { fresh_classes: ['random'] }, false)['verdict'], 'NOT_PROVEN')
  })
})

// ---------------------------------------------------------------------------
// Round 2 #8: obligations discharged without exercising the risk
// repros: round2/adv-1/f5_obligation_discharge.py, adv-2/f10_obligation_discharge.py, adv-3/e_obligation_deadlock.py
// ---------------------------------------------------------------------------
describe('obligations', () => {
  beforeEach(() => {
    P.dump(join(t.ws.obligations, 'OBL-PACKED.json'), { id: 'OBL-PACKED', observables: [`${UNIT}/ACCTFILE.field:amt`],
      requirement: 'hazard:invalid_packed', min_count: 2, accepted_by: 'x', status: 'open' })
    const ids = t.pool(24)
    P.buildSet(t.ws, 'S', GU, 'executable', ids, {}, {})
    for (const c of ids) t.observe(c, obs([{ amt: '1.00' }]), obs([{ amt: '1.00' }]))
  })
  test('a run that never hit the hazard does not discharge', () => {
    t.judge('S')
    assert.equal(P.discharge(t.ws)[0]!['status'], 'open')
  })
  test('only enough passing hazard inputs discharge', () => {
    const hz = [100, 101].map((i) => t.case(i, ['hazard:invalid_packed']))
    for (const c of hz) t.observe(c, obs([{ amt: 'ABEND' }]), obs([{ amt: 'ABEND' }]))
    t.judge('S', { key: 'K-LATER', fresh: hz })
    assert.equal(P.discharge(t.ws)[0]!['status'], 'discharged')
  })
  test('a mismatch on the hazard blocks discharge', () => {
    const hz = [100, 101, 102].map((i) => t.case(i, ['hazard:invalid_packed']))
    for (const c of hz.slice(0, 2)) t.observe(c, obs([{ amt: 'ABEND' }]), obs([{ amt: 'ABEND' }]))
    t.observe(hz[2]!, obs([{ amt: 'ABEND' }]), obs([{ amt: '73.40' }]))
    t.judge('S', { fresh: hz })
    assert.equal(P.discharge(t.ws)[0]!['status'], 'open')
  })
})

// ---------------------------------------------------------------------------
// Round 2 #9 (round 1 #8): the window ended without a month-end
// repros: round2/adv-1/f6_calendar_parm.py, adv-2/f8_calendar.py, adv-3/f_calendar_dow.py, round1/adv-1/p7_estep_window.py
// ---------------------------------------------------------------------------
describe('calendar', () => {
  test('events from the clock', () => {
    assert.ok(P.calendarEvents('2026-11-13T02:00:00').includes('weekday_fri'))
    assert.ok(P.calendarEvents('2026-11-30T23:00:00').includes('month_end_30'))
    assert.ok(P.calendarEvents('2028-02-29T23:00:00').includes('month_end_feb'))
    assert.ok(P.calendarEvents('2026-12-31T23:00:00').includes('quarter_end'))
    assert.ok(P.calendarEvents('2026-11-30T23:00:00', { 'PARM-CYCLE': 'ME' }).includes('run_mode_ME'))
  })
  test('one day does not cover the minimum window', () => {
    const ids = t.pool(24, ['random'], { clock: '2026-11-09T02:00:00' })
    P.buildSet(t.ws, 'S', GU, 'executable', ids, {}, {})
    for (const c of ids) t.observe(c, obs([{ v: '1' }]), obs([{ v: '1' }]))
    t.judge('S')
    const v = P.verdict(t.ws, GU, 'V10', 'K1', { calendar_events: P.MINIMUM_WINDOW }, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((r: string) => r.includes('month_end_31')))
  })
})

// ---------------------------------------------------------------------------
// Round 1 #4: generators and rule coverage miss construct semantics
// repro: round1/adv-1/p2_mutation_antistub.py (and the hazard rows of round 2)
// ---------------------------------------------------------------------------
test('every required hazard must be reached', () => {
  const ids = t.pool(24)
  P.buildSet(t.ws, 'S', GU, 'executable', ids, {}, {})
  for (const c of ids) t.observe(c, obs([{ v: '1' }]), obs([{ v: '1' }]))
  t.judge('S')
  const v = P.verdict(t.ws, GU, 'V4', 'K1', { hazards: ['rounded', 'size_error'] }, false)
  assert.equal(v['verdict'], 'NOT_PROVEN')
  assert.equal(v['gaps'].length, 2)
})

// ---------------------------------------------------------------------------
// Content addressing (round 2 dropped ideas: hidden inputs, clock, session)
// ---------------------------------------------------------------------------
describe('content addressing', () => {
  test('inputs that differ only in clock or store are different cases', () => {
    const a = P.caseId(inp({ clock: '2026-11-29T02:00:00' }))
    assert.notEqual(a, P.caseId(inp({ clock: '2026-11-30T02:00:00' })))
    assert.notEqual(a, P.caseId(inp({ clock: '2026-11-29T02:00:00', stores: { ACCT: 'sha256:1' } })))
  })
  test('a case must state every input', () => {
    assert.throws(() => P.caseId({ records: {}, params: {} }), P.Bad)
  })
  test('exact decimals: no float rounding, scale kept', () => {
    assert.equal(P.decStr(P.dec('-42.10')!), '-42.10')
    assert.equal(P.decStr({ n: P.dec('0.1')!.n + P.dec('0.2')!.n, s: 1 }), '0.3')
  })
})

// ---------------------------------------------------------------------------
// M2 exit run: the reference environment cannot be trusted for one class (§6.8, signed oracle cap)
// ---------------------------------------------------------------------------
describe('oracle caps', () => {
  let ids: string[]
  let bad: string[]
  const row = [{ v: '1' }]
  const cap = (signed: boolean) => P.dump(join(t.ws.oracles, 'caps', 'CAP-1.json'), { id: 'CAP-1', gate_unit: GU, class: 'abend:open_failure',
    environment: 'gnucobol-bdb', observables: [`${UNIT}.abend`], reason: 'BDB status 30 is not z/OS behaviour', signed_by: signed ? 'a person' : null })
  beforeEach(() => {
    ids = t.pool(24)
    bad = [200, 201].map((i) => t.case(i, ['abend:open_failure']))
    P.buildSet(t.ws, 'S', GU, 'executable', [...ids, ...bad], {}, {})
    for (const c of ids) t.observe(c, obs(row), obs(row))
    for (const c of bad) t.observe(c, { ...obs([]), abend: 'U999', return_code: null }, { ...obs(row), abend: null })
    t.judge('S', { env: 'gnucobol-bdb' })
  })

  test('an unsigned cap changes nothing, and says so', () => {
    cap(false)
    const v = P.verdict(t.ws, GU, 'V3', 'K1', {}, false)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((r: string) => r.includes('2 case(s) fail')))
    assert.ok(v['reasons'].some((r: string) => r.includes('unsigned cap(s) ignored: CAP-1')))
  })
  test('a signed cap turns the class into an obligation, which a person must still accept', () => {
    cap(true)
    const v = P.verdict(t.ws, GU, 'V3', 'K1', {}, true)
    assert.equal(v['verdict'], 'NOT_PROVEN')
    assert.ok(v['reasons'].some((r: string) => r.includes('CAP-1')), v['reasons'].join('\n'))
    assert.deepEqual(v['capped'], [{ cap: 'CAP-1', class: 'abend:open_failure', cases: 2 }])
    for (const f of readdirSync(t.ws.obligations)) P.dump(join(t.ws.obligations, f), { ...P.load(join(t.ws.obligations, f)), accepted_by: 'a person' })
    assert.equal(P.verdict(t.ws, GU, 'V3', 'K1', {}, false)['verdict'], 'PROVISIONAL')
  })
  test('runs in the capped environment never discharge it; another environment can', () => {
    cap(true)
    P.verdict(t.ws, GU, 'V3', 'K1', {}, true)
    t.clearFailed('S')
    for (const c of bad) t.observe(c, { ...obs([]), abend: 'U999', return_code: null }, { ...obs([]), abend: 'U999', return_code: null })
    t.judge('S', { key: 'K2', env: 'gnucobol-bdb' })
    assert.ok(P.discharge(t.ws).every((o) => o['status'] === 'open'))
    t.judge('S', { key: 'K3', env: 'zos-test-lpar' })
    assert.ok(P.discharge(t.ws).every((o) => o['status'] === 'discharged'))
  })
  test('a cap covers only its own class: other failures still block', () => {
    cap(true)
    t.clearFailed('S')
    t.observe(ids[0]!, obs(row), obs([{ v: '2' }]))
    t.judge('S', { env: 'gnucobol-bdb' })
    const v = P.verdict(t.ws, GU, 'V3', 'K1', {}, false) // the case passed in the first run and fails now
    assert.equal(v['verdict'], 'FLAKY')
    assert.ok(v['reasons'].some((r: string) => r.includes('1 case(s) both pass and fail')))
  })
})

test('compare (self-check) counts per class and records no evidence', () => {
  const dev = join(t.dir, 'dev')
  mkdirSync(dev)
  P.dump(join(dev, 'a.json'), { input: inp(), expected: obs([{ v: '1' }]), classes: ['random'] })
  P.dump(join(dev, 'b.json'), { input: inp(), expected: obs([{ v: '2' }]), classes: ['random'] })
  P.dump(join(t.dir, 'M', 'a.json'), obs([{ v: '1' }]))
  P.dump(join(t.dir, 'M', 'b.json'), obs([{ v: '9' }]))
  const out = P.compareOnly(dev, join(t.dir, 'M'), 'exact', UNIT, join(t.dir, 'tmp'))
  assert.deepEqual(out, { passed: 1, total: 2, classes: [{ class: 'random', passed: 1, total: 2 }] })
  assert.equal([...P.allRuns(t.ws)].length, 0)
})

// Owned elsewhere (no script to test):
//   round 2 #10 capability preflight -> commands/preflight.md (smoke runs, per construct)
//   round 2 #11 generalisation check -> deleted in v0.3; nothing to test
//   round 1 #5 data step V7, #6 Pack interfaces -> M6 (store probes) and commands/preflight.md
