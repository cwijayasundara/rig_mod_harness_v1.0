#!/usr/bin/env node
/**
 * Score a /rig:map run on carddemo-mini against tests/fixtures/carddemo-mini.EXPECTED.md.
 *
 *     node tests/check_map.ts tests/runs/<run>/analysis/carddemo
 *
 * Prints one line per check and exits non-zero if any **must** item fails. It only reads the run's output, and run
 * workspaces deny reading this file, so a run cannot game it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

type Obj = Record<string, any>

const W = process.argv[2]
if (!W) {
  console.error('usage: node tests/check_map.ts <run>/analysis/<system>')
  process.exit(2)
}
const load = (p: string): any => JSON.parse(readFileSync(join(W, p), 'utf8'))
const U: Obj[] = load('unresolved.json')['unresolved']
const G = load('graph.json')
const E: Obj[] = G['edges']
const N = new Map<string, Obj>(G['nodes'].map((n: Obj) => [n['id'], n]))
const H: Obj[] = load('hazards.json')['hazards']
let failures = 0

function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Unresolved entries cited at any of these lines of path. */
const site = (path: string, ...lines: number[]) =>
  U.filter((u) => lines.some((ln) => new RegExp(`${esc(path)}:${ln}\\b`).test(u['loc'] ?? '')))
const isOpen = (es: Obj[]) => es.length > 0 && es.every((u) => u['status'] === 'open')
const mentions = (name: string, kind?: string) => U.filter((u) => JSON.stringify(u).includes(name) && (kind === undefined || u['kind'] === kind))
const edges = (kind: string, from = '', to = '') => E.filter((e) => e['kind'] === kind && e['from'].includes(from) && e['to'].includes(to))

// Unresolved, must stay open
check('COMEN01C XCTL table (156) open', isOpen(site('COMEN01C.cbl', 155, 156)))
check('COMEN01C XCTL table (184/185) open', isOpen(site('COMEN01C.cbl', 184, 185)))
check('COMEN01C XCTL CDEMO-TO-PROGRAM (201/202) open', isOpen(site('COMEN01C.cbl', 201, 202)))
for (const ln of [182, 216, 251]) check(`CODATE01 MQOPEN ${ln} open`, isOpen(site('CODATE01.cbl', ln)))
check('CBTRN03C missing_source', mentions('CBTRN03C', 'missing_source').length > 0)
check('MVSWAIT missing_source', mentions('MVSWAIT', 'missing_source').length > 0)
const cee = N.get('program:CEE3ABD')?.['attrs'] ?? {}
check('CEE3ABD vendor (documented) or missing_source', cee['source'] === 'vendor' || mentions('CEE3ABD', 'missing_source').length > 0)
for (const cb of ['DFHAID', 'DFHBMSCA', 'SQLCA', 'CMQGMOV', 'CMQPMOV', 'CMQMDV', 'CMQODV', 'CMQV', 'CMQTML']) {
  check(`copybook ${cb} missing`, mentions(cb, 'missing_copybook').length > 0)
}
check('TDQ JOBS job_submission', U.some((u) => u['kind'] === 'job_submission' && JSON.stringify(u).includes('JOBS')))

// Resolved by constant
for (const [name, path, lines] of [['USRSEC file', 'COSGN00C.cbl', [211, 212]], ['COSGN00C TRANSID', 'COSGN00C.cbl', [98, 99]],
  ['COMEN01C TRANSID', 'COMEN01C.cbl', [107, 108]]] as const) {
  const s = site(path, ...lines)
  check(`${name} resolved by constant`, s.length > 0 && s.every((u) => u['status'] === 'resolved' && u['resolved_by'] === 'constant'))
}
check('COSGN00C static XCTLs', edges('transfers', 'COSGN00C', 'COADM01C').length > 0 && edges('transfers', 'COSGN00C', 'COMEN01C').length > 0)

// Edges
check('INTRDRJ1 submits INTRDRJ2', edges('submits', 'INTRDRJ1', 'INTRDRJ2').length > 0)
check('FTP transmits to external', E.some((e) => e['kind'] === 'transmits' && e['to'].startsWith('external:')))
check('MNTTRDB2 runs COBTUPDT', edges('runs', 'MNTTRDB2', 'COBTUPDT').length > 0)
// A write may hang off the program, or off the step that runs it, citing the program's EXEC SQL lines.
check('COBTUPDT writes TRANSACTION_TYPE', edges('writes', 'COBTUPDT', 'TRANSACTION_TYPE').length > 0
  || E.some((e) => e['kind'] === 'writes' && e['from'] === 'step:MNTTRDB2/STEP1' && e['to'].includes('TRANSACTION_TYPE') && String(e['loc']).includes('COBTUPDT')))
check('UNLDPADB runs PAUDBUNL', edges('runs', 'UNLDPADB', 'PAUDBUNL').length > 0)
check('TRANREPT expands REPROC', edges('expands', 'TRANREPT', 'REPROC').length > 0)
check('INTCALC runs CBACT04C', edges('runs', 'INTCALC', 'CBACT04C').length > 0)
check('INTCALC writes ACCTDATA', edges('writes', '', 'ACCTDATA.VSAM.KSDS').length > 0)
check('INTCALC writes SYSTRAN GDG', edges('writes', '', 'SYSTRAN').length > 0)
check('CC00 entry COSGN00C', edges('entry', 'CC00', 'COSGN00C').length > 0)
check('CM00 entry COMEN01C', edges('entry', 'CM00', 'COMEN01C').length > 0)

// Hazards
const kinds = new Map<string, number>()
for (const h of H) kinds.set(h['hazard'], (kinds.get(h['hazard']) ?? 0) + 1)
check('truncation at CBACT04C:464', H.some((h) => h['loc'].includes('CBACT04C.cbl:464') && h['hazard'] === 'truncation'))
for (const k of ['run_mode', 'century_window', 'ebcdic_collation', 'invalid_packed']) check(`hazard ${k} found`, (kinds.get(k) ?? 0) > 0, `(${kinds.get(k) ?? 0})`)

// Surfaces and inventory
const surfDir = join(W, 'surfaces')
const surfFiles = readdirSync(surfDir).filter((f) => f.endsWith('.json'))
const complete = surfFiles.flatMap((f) => JSON.parse(readFileSync(join(surfDir, f), 'utf8'))['observables'])
  .filter((o: Obj) => o['consumers']?.['complete'])
check('no consumer list complete', complete.length === 0, `(${complete.length} complete)`)
for (const gu of ['job-INTCALC', 'job-READCUST', 'job-WAITSTEP', 'job-TRANREPT', 'job-MNTTRDB2', 'job-UNLDPADB', 'tx-CC00', 'tx-CM00']) {
  check(`surface ${gu}`, existsSync(join(surfDir, `${gu}.json`)))
}
const inv = load('inventory.json')
check('inventory has all 51 files', inv['totals']?.['files'] === 51, JSON.stringify(inv['totals']))

// Secrets: the FTP control cards hold a demo password
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
const leaks = walk(W).filter((f) => readFileSync(f, 'latin1').includes('ftpdemo1')).map((f) => relative(W, f))
check('no FTP password in any output', leaks.length === 0, JSON.stringify(leaks))

console.log(`\n${failures} failed`)
process.exit(failures ? 1 : 0)
