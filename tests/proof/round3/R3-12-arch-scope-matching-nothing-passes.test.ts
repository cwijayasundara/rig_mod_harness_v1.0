/**
 * R3-12: `rig_arch.ts check --scope <prefixes>` moves every file violation whose path does not start with a prefix into
 * `outside_scope`, and `pass` counts only the rest. A scope that matches no file at all (a typo, a path relative to the
 * wrong root, `src/main/java/cd/intrest`) therefore passes a tree with real dependency violations. It should fail closed.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as A from '../../../plugins/rig/scripts/rig_arch.ts'

test('a scope that matches no source file is not a pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-12-'))
  const log = console.log
  try {
    const dec = join(dir, 'analysis', 'sys', 'decomposition')
    mkdirSync(dec, { recursive: true })
    const spec = { language: 'java', base_package: 'cd', adrs: ['ADR-0001'],
      modules: { customer: { packages: ['cd.customer'], api: ['cd.customer'], depends_on: [] },
                 interest: { packages: ['cd.interest'], api: ['cd.interest'], depends_on: [] } }, stores: {} }
    writeFileSync(join(dec, 'MODULES.json'), JSON.stringify(spec))
    writeFileSync(join(dir, 'analysis', 'sys', 'ADR-0001.md'), '# ADR-0001\n')
    const h = A.hashes(join(dec, 'MODULES.json'), join(dir, 'analysis', 'sys'), ['ADR-0001'])
    writeFileSync(join(dec, 'signoffs.json'), JSON.stringify([{ adr: 'ADR-0001', adr_sha256: h['adrs']['ADR-0001'], modules_sha256: h['modules_sha256'], signed_by: 'owner', signed_on: '2026-11-06' }]))
    const src = join(dir, 'modernized', 'cd')
    mkdirSync(join(src, 'customer'), { recursive: true }); mkdirSync(join(src, 'interest'), { recursive: true })
    writeFileSync(join(src, 'customer', 'Cust.java'), 'package cd.customer;\npublic class Cust {}')
    // interest uses customer without depending on it: a dependency violation in the very module being restructured.
    writeFileSync(join(src, 'interest', 'Calc.java'), 'package cd.interest;\nimport cd.customer.Cust;\npublic class Calc { Cust c; }')
    let out = ''
    console.log = (s: string) => { out += s }
    const base = ['check', '--ws', dir, '--system', 'sys', '--root', 'modernized']
    assert.equal(A.main(base), 1) // control: the violation is found
    out = ''
    const code = A.main([...base, '--scope', 'modernized/cd/intrest'])
    console.log = log
    assert.notEqual(code, 0, `scope matching no file passed: ${out.slice(0, 200)}`)
  } finally { console.log = log; rmSync(dir, { recursive: true, force: true }) }
})
