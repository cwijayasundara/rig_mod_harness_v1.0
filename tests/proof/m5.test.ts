/** M5 (restructure): architecture tests, deltas applied in comparison, ADR sign-offs a subagent cannot write. */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { decide } from '../../plugins/rig/hooks/guard.ts'
import * as A from '../../plugins/rig/scripts/rig_arch.ts'
import * as P from '../../plugins/rig/scripts/rig_proof.ts'

const SPEC = {
  language: 'java', base_package: 'cd', adrs: ['ADR-0001'],
  modules: {
    app: { packages: ['cd'], api: [], depends_on: ['customer', 'interest'] },
    customer: { packages: ['cd.customer'], api: ['cd.customer'], depends_on: ['shared'], owns: ['CUSTFILE'] },
    interest: { packages: ['cd.interest'], api: ['cd.interest'], depends_on: ['shared'], owns: ['ACCTFILE'] },
    shared: { packages: ['cd.shared'], api: ['cd.shared'], depends_on: [] },
  },
  stores: { CUSTFILE: { markers: ['DD_CUSTFILE'] }, ACCTFILE: { markers: ['DD_ACCTFILE'] } },
}
const H = { modules_sha256: 'm', adrs: { 'ADR-0001': 'a' } }
const SIGNED = [{ adr: 'ADR-0001', adr_sha256: 'a', modules_sha256: 'm', signed_by: 'owner', signed_on: '2026-11-05' }]
const f = (path: string, text: string) => ({ path, text })
const GOOD = [
  f('cd/Main.java', 'package cd;\nimport cd.customer.Cbcus01c;\nimport cd.interest.Intcalc;\nclass Main {}'),
  f('cd/customer/Cbcus01c.java', 'package cd.customer;\nimport cd.shared.Zoned;\npublic class Cbcus01c { String dd = System.getenv("DD_CUSTFILE"); }'),
  f('cd/interest/Intcalc.java', 'package cd.interest;\nimport cd.shared.Zoned;\npublic class Intcalc { String dd = "DD_ACCTFILE"; }'),
  f('cd/shared/Zoned.java', 'package cd.shared;\npublic class Zoned {}'),
]
const rules = (v: A.Violation[]) => v.map((x) => x.rule).sort()

describe('rig_arch: module rules of the signed decomposition', () => {
  test('a clean tree passes', () => assert.deepEqual(A.check(SPEC, GOOD, SIGNED, H), []))
  test('a file in no module is unassigned', () => {
    assert.deepEqual(rules(A.check(SPEC, [...GOOD, f('x/Y.java', 'package x;\nclass Y {}')], SIGNED, H)), ['unassigned'])
  })
  test('a reference to an undeclared module is a dependency violation (import or fully qualified)', () => {
    const imp = f('cd/customer/Bad.java', 'package cd.customer;\nimport cd.interest.Intcalc;\nclass Bad {}')
    const fq = f('cd/customer/Bad2.java', 'package cd.customer;\nclass Bad2 { Object o = new cd.interest.Intcalc(); }')
    assert.deepEqual(rules(A.check(SPEC, [...GOOD, imp, fq], SIGNED, H)), ['dependency', 'dependency'])
  })
  test('comments and strings are not references', () => {
    const c = f('cd/customer/C.java', 'package cd.customer;\n// cd.interest.Intcalc\n/* cd.interest.Intcalc */\nclass C { String s = "cd.interest.Intcalc"; }')
    assert.deepEqual(A.check(SPEC, [...GOOD, c], SIGNED, H), [])
  })
  test('a class outside the api, and a wildcard import, are api violations', () => {
    const spec = structuredClone(SPEC)
    spec.modules.shared.packages.push('cd.shared.impl')
    const inner = f('cd/shared/impl/Raw.java', 'package cd.shared.impl;\npublic class Raw {}')
    const use = f('cd/customer/U.java', 'package cd.customer;\nimport cd.shared.impl.Raw;\nimport cd.shared.*;\nclass U {}')
    assert.deepEqual(rules(A.check(spec, [...GOOD, inner, use], SIGNED, H)), ['api', 'api'])
  })
  test('a cycle and an unknown module in depends_on are named', () => {
    const spec = structuredClone(SPEC) as any
    spec.modules.shared.depends_on = ['customer', 'ghost']
    const v = A.check(spec, GOOD, SIGNED, H)
    assert.ok(v.some((x) => x.rule === 'module' && /ghost/.test(x.detail)))
    assert.ok(v.some((x) => x.rule === 'module' && /cycle/.test(x.detail)))
  })
  test('each store has exactly one owner, and only the owner touches its markers', () => {
    const spec = structuredClone(SPEC) as any
    spec.modules.interest.owns = ['ACCTFILE', 'CUSTFILE']
    assert.ok(rules(A.check(spec, GOOD, SIGNED, H)).includes('store_owner'))
    const sneak = f('cd/interest/Peek.java', 'package cd.interest;\nclass Peek { String p = System.getenv("DD_CUSTFILE"); }')
    const v = A.check(SPEC, [...GOOD, sneak], SIGNED, H)
    assert.deepEqual(rules(v), ['store_access'])
    assert.equal(v[0]!.line, 2)
  })
  test('the sign-off must match this exact ADR and MODULES.json', () => {
    assert.deepEqual(rules(A.check(SPEC, GOOD, null, H)), ['signoff'])
    assert.deepEqual(rules(A.check(SPEC, GOOD, [{ ...SIGNED[0], signed_by: null }], H)), ['signoff'])
    assert.match(A.check(SPEC, GOOD, SIGNED, { ...H, adrs: { 'ADR-0001': 'changed' } })[0]!.detail, /changed after owner signed/)
    assert.match(A.check(SPEC, GOOD, SIGNED, { ...H, modules_sha256: 'changed' })[0]!.detail, /MODULES.json changed/)
  })
  test('only java is supported; anything else is bad input, not a pass', () => {
    assert.throws(() => A.check({ ...SPEC, language: 'cobol' }, GOOD, SIGNED, H), /only java/)
  })
})

describe('deltas are applied when comparing', () => {
  const U = 'INTCALC'
  const legacy = { return_code: 0, abend: null, messages: ['A', 'B'], stores: { ACCTDATA: { records: [{ ID: '1', BAL: '5' }] } } }
  test('a store and field rename, mapped, compares equal', () => {
    const modern = { return_code: 0, abend: null, messages: ['A', 'B'], stores: { ACCOUNTS: { records: [{ ID: '1', BALANCE: '5' }] } } }
    assert.equal(P.exactCompare(legacy, modern, U).equal, false)
    const d = { map: { 'INTCALC/ACCTDATA.store_write': 'INTCALC/ACCOUNTS.store_write', 'INTCALC/ACCTDATA.field:BAL': 'INTCALC/ACCOUNTS.field:BALANCE' } }
    const x = P.applyDelta(legacy, modern, d, U)
    assert.deepEqual(P.exactCompare(x.legacy, x.modern, U), { equal: true, compared: P.exactCompare(x.legacy, x.modern, U).compared, diffs: [] })
  })
  test('removed and added observables leave their side; nothing else is forgiven', () => {
    const modern = { return_code: 0, abend: null, stores: { ACCTDATA: { records: [{ ID: '1', BAL: '5', NEW: 'x' }] } } }
    const d = { removed: ['INTCALC.message'], added: ['INTCALC/ACCTDATA.field:NEW'] }
    const x = P.applyDelta(legacy, modern, d, U)
    assert.equal(P.exactCompare(x.legacy, x.modern, U).equal, true)
    const y = P.applyDelta(legacy, { ...modern, return_code: 4 }, d, U)
    assert.deepEqual(P.exactCompare(y.legacy, y.modern, U).diffs, ['INTCALC.return_code'])
  })
  test('a mapping that changes the kind, or an id the comparator never records, is bad input', () => {
    assert.throws(() => P.applyDelta(legacy, legacy, { map: { 'INTCALC.message': 'INTCALC.screen' } }, U), /keeps the kind/)
    assert.throws(() => P.applyDelta(legacy, legacy, { removed: ['INTCALC.message:banner'] }, U), /carries a suffix/)
    assert.throws(() => P.applyDelta(legacy, legacy, { removed: ['INTCALC/ACCTDATA.cardinality'] }, U), /cannot remove/)
  })
  test('the judge refuses a delta nobody approved', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rig-m5-'))
    try {
      writeFileSync(join(dir, 'DELTA-1.json'), JSON.stringify({ id: 'DELTA-1', map: {}, approved_by: null }))
      assert.throws(() => P.approvedDeltas([join(dir, 'DELTA-1.json')]), /not approved/)
      writeFileSync(join(dir, 'DELTA-2.json'), JSON.stringify({ id: 'DELTA-2', map: {}, approved_by: 'owner' }))
      assert.equal(P.approvedDeltas([join(dir, 'DELTA-2.json')]).length, 1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test('delta check reads both id lists from surfaces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rig-m5-'))
    try {
      mkdirSync(join(dir, 'obligations/cd'), { recursive: true })
      const surf = (ids: string[]) => ({ gate_unit: 'job:INTCALC', observables: ids.map((id) => ({ id })) })
      writeFileSync(join(dir, 'l.json'), JSON.stringify(surf(['INTCALC.message', 'INTCALC.return_code'])))
      writeFileSync(join(dir, 'm.json'), JSON.stringify(surf(['INTCALC.return_code'])))
      writeFileSync(join(dir, 'd.json'), JSON.stringify({ map: { 'INTCALC.return_code': 'INTCALC.return_code' }, approved_by: 'owner' }))
      const log = console.log
      let out = ''
      console.log = (s: string) => { out += s }
      try {
        assert.equal(P.main(['delta', '--ws', dir, '--system', 'cd', '--file', join(dir, 'd.json'), '--legacy-surface', join(dir, 'l.json'), '--modern-surface', join(dir, 'm.json')]), 1)
      } finally { console.log = log }
      assert.match(out, /INTCALC.message is neither mapped nor removed/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('guard: ADR sign-offs are a person\'s', () => {
  const call = (agent?: string) => decide({ tool_name: 'Write', tool_input: { file_path: '/ws/analysis/cd/decomposition/signoffs.json' }, cwd: '/ws', ...(agent && { agent_type: agent }) }, '/ws')
  test('a subagent may not write them; the main session recording a person\'s answer may', () => {
    assert.match(call('rig:architecture-critic')!, /person's decision/)
    assert.equal(call(), null)
  })
  test('the critic may write its drafts', () => {
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: '/ws/analysis/cd/ADR-0001.md' }, cwd: '/ws', agent_type: 'rig:architecture-critic' }, '/ws'), null)
  })
})

describe('rig_arch: surface stores (M5 session 1)', () => {
  test('a store on a surface that MODULES.json does not name fails; surface_names resolves it', () => {
    assert.match(A.check(SPEC, GOOD, SIGNED, H, ['CUSTFILE', 'ACCTDATA'])[0]!.detail, /ACCTDATA is on a surface/)
    const spec = structuredClone(SPEC) as any
    spec.stores.ACCTFILE.surface_names = ['ACCTDATA']
    assert.deepEqual(A.check(spec, GOOD, SIGNED, H, ['CUSTFILE', 'ACCTDATA']), [])
  })
})

describe('rig_arch: surface store ids (M5 session 1 on carddemo-mini)', () => {
  test('dotted store names stay whole; ids outside the grammar name no store', () => {
    assert.equal(A.surfaceStore('REMOTE.welcome.txt.store_write'), 'REMOTE.welcome.txt')
    assert.equal(A.surfaceStore('ACCTDATA.field:ACCT-ID'), 'ACCTDATA')
    assert.equal(A.surfaceStore('return_code'), null)
    assert.equal(A.surfaceStore('SYSOUT.message'), null)
  })
})
