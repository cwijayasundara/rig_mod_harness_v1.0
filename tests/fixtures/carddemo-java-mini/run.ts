#!/usr/bin/env node
// Case runner for the CardDemo batch monolith. Same command on both sides of a restructure: only --classes differs.
//
//   node run.ts <case.json> <observation-out.json> [--classes DIR]      (default: ./classes)
//
// The job comes from the case's records: CUSTFILE -> READCUST, TCATBALF/XREFFILE/DISCGRP/ACCTFILE -> INTCALC.
// It runs `java -cp <classes> carddemo.Main <JOB>` with the job's DD_* environment, PARM and RIG_CLOCK.
// Observation: {return_code, abend, messages, screens: null, stores}. Abend: stderr "ABEND <n>" with exit n & 0xFF
// -> abend "U<n>"; "ABEND S0C7" -> abend "S0C7". Anything else on stderr, a signal or a timeout -> "crash".
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

type Rec = Record<string, string>
type Layout = [string, number][]
const JAVA = join(process.env['JAVA_HOME'] ?? '/opt/homebrew/opt/openjdk@21', 'bin', 'java')

const CUST: Layout = [['CUST-ID', 9], ['CUST-FIRST-NAME', 25], ['CUST-MIDDLE-NAME', 25], ['CUST-LAST-NAME', 25],
  ['CUST-ADDR-LINE-1', 50], ['CUST-ADDR-LINE-2', 50], ['CUST-ADDR-LINE-3', 50], ['CUST-ADDR-STATE-CD', 2],
  ['CUST-ADDR-COUNTRY-CD', 3], ['CUST-ADDR-ZIP', 10], ['CUST-PHONE-NUM-1', 15], ['CUST-PHONE-NUM-2', 15],
  ['CUST-SSN', 9], ['CUST-GOVT-ISSUED-ID', 20], ['CUST-DOB-YYYY-MM-DD', 10], ['CUST-EFT-ACCOUNT-ID', 10],
  ['CUST-PRI-CARD-HOLDER-IND', 1], ['CUST-FICO-CREDIT-SCORE', 3], ['FILLER', 168]]
const ACCT: Layout = [['ACCT-ID', 11], ['ACCT-ACTIVE-STATUS', 1], ['ACCT-CURR-BAL', 12], ['ACCT-CREDIT-LIMIT', 12],
  ['ACCT-CASH-CREDIT-LIMIT', 12], ['ACCT-OPEN-DATE', 10], ['ACCT-EXPIRAION-DATE', 10], ['ACCT-REISSUE-DATE', 10],
  ['ACCT-CURR-CYC-CREDIT', 12], ['ACCT-CURR-CYC-DEBIT', 12], ['ACCT-ADDR-ZIP', 10], ['ACCT-GROUP-ID', 10], ['FILLER', 178]]
const TRAN: Layout = [['TRAN-ID', 16], ['TRAN-TYPE-CD', 2], ['TRAN-CAT-CD', 4], ['TRAN-SOURCE', 10], ['TRAN-DESC', 100],
  ['TRAN-AMT', 11], ['TRAN-MERCHANT-ID', 9], ['TRAN-MERCHANT-NAME', 50], ['TRAN-MERCHANT-CITY', 50],
  ['TRAN-MERCHANT-ZIP', 10], ['TRAN-CARD-NUM', 16], ['TRAN-ORIG-TS', 26], ['TRAN-PROC-TS', 26], ['FILLER', 20]]
const TCAT: Layout = [['TRANCAT-ACCT-ID', 11], ['TRANCAT-TYPE-CD', 2], ['TRANCAT-CD', 4], ['TRAN-CAT-BAL', 11], ['FILLER', 22]]
const XREF: Layout = [['XREF-CARD-NUM', 16], ['XREF-CUST-ID', 9], ['XREF-ACCT-ID', 11], ['FILLER', 14]]
const DISC: Layout = [['DIS-ACCT-GROUP-ID', 10], ['DIS-TRAN-TYPE-CD', 2], ['DIS-TRAN-CAT-CD', 4], ['DIS-INT-RATE', 6], ['FILLER', 28]]

const bad = (m: string): never => { console.error(JSON.stringify({ error: m })); process.exit(2) }
const pack = (recs: Rec[], l: Layout): Buffer => Buffer.from(recs.map((r) => l.map(([n, w]) => {
  const v = r[n]
  if (typeof v !== 'string' || v.length !== w) bad(`${n}: value must be a string of width ${w}`)
  return v
}).join('')).join(''), 'latin1')
function unpack(data: Buffer, l: Layout): Rec[] {
  const w = l.reduce((s, [, n]) => s + n, 0)
  const out: Rec[] = []
  for (let off = 0; off + w <= data.length; off += w) {
    const r: Rec = {}
    let p = off
    for (const [n, k] of l) { r[n] = data.subarray(p, p + k).toString('latin1'); p += k }
    out.push(r)
  }
  return out
}
const byKey = (k: string) => (a: Rec, b: Rec) => (a[k]! < b[k]! ? -1 : a[k]! > b[k]! ? 1 : 0)

const argv = process.argv.slice(2)
const ci = argv.indexOf('--classes')
const classes = resolve(ci < 0 ? join(import.meta.dirname, 'classes') : argv.splice(ci, 2)[1]!)
if (argv.length !== 2) bad('usage: run.ts <case.json> <observation-out.json> [--classes DIR]')
const raw = JSON.parse(readFileSync(argv[0]!, 'utf8'))
const inp = raw.input ?? raw
const recs = inp.records ?? bad('input lacks records')
const job = 'CUSTFILE' in recs ? 'READCUST' : 'INTCALC'

const tmp = mkdtempSync(join(tmpdir(), `carddemo-${job.toLowerCase()}-`))
const env: Record<string, string> = { PATH: '/usr/bin:/bin', TZ: 'UTC' }
const stores: Record<string, { records: Rec[] }> = {}
let res
try {
  if (job === 'READCUST') {
    const c = recs.CUSTFILE
    let path = join(tmp, 'CUSTFILE')
    if (c === null) path = join(tmp, 'absent', 'CUSTFILE')
    else if (Array.isArray(c)) writeFileSync(path, pack([...c].sort(byKey('CUST-ID')), CUST))
    else if (typeof c?.not_indexed_text === 'string') writeFileSync(path, Buffer.from(c.not_indexed_text, 'ascii'))
    else bad('CUSTFILE must be a list, null or {"not_indexed_text": ...}')
    env['DD_CUSTFILE'] = path
  } else {
    env['PARM'] = String(inp.params?.PARM ?? '')
    env['RIG_CLOCK'] = String(inp.clock ?? '')
    for (const [dd, l] of [['TCATBALF', TCAT], ['XREFFILE', XREF], ['DISCGRP', DISC], ['ACCTFILE', ACCT]] as const) {
      const path = join(tmp, dd)
      if (recs[dd] != null) writeFileSync(path, pack(recs[dd], l)) // null: dataset missing, path left absent
      env[`DD_${dd}`] = path
    }
    env['DD_TRANSACT'] = join(tmp, 'TRANSACT')
  }
  const wd = join(tmp, 'work')
  mkdirSync(wd)
  res = spawnSync(JAVA, ['-cp', classes, 'carddemo.Main', job], { env, cwd: wd, timeout: 120_000, maxBuffer: 1 << 28 })
  if (job === 'INTCALC') {
    stores['ACCTDATA'] = { records: existsSync(env['DD_ACCTFILE']!) ? unpack(readFileSync(env['DD_ACCTFILE']!), ACCT).sort(byKey('ACCT-ID')) : [] }
    stores['SYSTRAN'] = { records: existsSync(env['DD_TRANSACT']!) ? unpack(readFileSync(env['DD_TRANSACT']!), TRAN) : [] }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const lines = (res.stdout ?? Buffer.alloc(0)).toString('latin1').split('\n')
if (lines.at(-1) === '') lines.pop()
const err = (res.stderr ?? Buffer.alloc(0)).toString('latin1').trim()
const obs: Record<string, unknown> = { return_code: res.status, abend: null, messages: lines, screens: null, stores }
let crash: string | null = null
const m = /^ABEND (S0C7|-?\d+)$/.exec(err)
if (res.error) crash = (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timeout' : `run failed: ${res.error.message}`
else if (res.signal) crash = `ended by signal ${res.signal}`
else if (m) { obs['abend'] = m[1] === 'S0C7' ? 'S0C7' : `U${m[1]}`; obs['return_code'] = null }
else if (err) crash = `stderr: ${err.slice(0, 200)}`
else if (res.status !== 0) crash = `exit code ${res.status} without abend marker`
if (crash !== null) obs['crash'] = crash
mkdirSync(dirname(resolve(argv[1]!)), { recursive: true })
writeFileSync(argv[1]!, JSON.stringify(obs, null, 1) + '\n')
