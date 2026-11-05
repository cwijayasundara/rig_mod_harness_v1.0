#!/usr/bin/env node
/**
 * RIG proof core (docs/PROPOSAL.md §5.3, §6). Node 24+ runs this file directly. No dependencies.
 *
 * Claude writes oracles, generators, comparators and normalizers, and runs both sides. This script decides: it hashes
 * cases, splits dev and sealed sets, runs comparisons, writes evidence with coverage, and computes every verdict. Its
 * output is the only verdict that counts.
 *
 *     node rig_proof.ts <command> [sub] --ws <workspace> --system <name> [options]
 *
 * Commands
 *   case add       add a case (content-addressed by its canonical input)
 *   set build      build or extend a dev/sealed oracle set for a gate unit
 *   compare        self-check: compare observations of given cases, print counts per class, record nothing
 *   judge          compare legacy and modern observations, record a run, print counts per class
 *   key            compute the evidence key of a gate unit and rung
 *   normalizer     check a normalizer against the consumer rules
 *   delta          check a delta's totality and obligation mapping (ids from --legacy-surface/--modern-surface)
 *   canary         run the canary sweep against a comparator
 *   verdict        compute the verdict of a gate unit and rung from every run under its key
 *   obligations    discharge obligations by coverage, and list what is open
 *   calendar       required calendar events for a gate unit and which runs covered them
 *   surface check  check that every observable id on a surface is one the comparator records
 *
 * Every command prints JSON and exits 0 when its check passes, 1 when it fails, 2 on bad input.
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Obj = Record<string, any>

export const INPUT_KEYS = ['records', 'params', 'clock', 'stores', 'session'] as const
export const RUNGS = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10']
const ORACLE_RUNGS = new Set(['V2', 'V3', 'V4', 'V6'])
const COMPARATOR_RUNGS = new Set(['V3', 'V4', 'V5'])
export const SEALED_MIN = 20
const SEALED_SHARE = 0.25

/** Bad input: exit 2. */
export class Bad extends Error {
  override name = 'Bad'
}

/** Canonical JSON: sorted keys at every level, no spaces. Identical bytes for identical values. */
export function canon(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  const o = v as Obj
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`
}

/** Sorted-key, two-space JSON for files people review. */
function pretty(v: unknown): string {
  const sortDeep = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sortDeep)
    : x !== null && typeof x === 'object' ? Object.fromEntries(Object.keys(x as Obj).sort().map((k) => [k, sortDeep((x as Obj)[k])]))
    : x
  return JSON.stringify(sortDeep(v), null, 2)
}

export const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')

export function load(path: string): any {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new Bad(`missing ${path}`)
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Bad(`${path}: ${(e as Error).message}`)
  }
}

export function dump(path: string, obj: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, pretty(obj) + '\n')
  renameSync(tmp, path)
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile()
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory()
const ls = (dir: string) => (isDir(dir) ? readdirSync(dir).sort() : [])
const uniqSorted = (xs: Iterable<string>) => [...new Set(xs)].sort()

export class WS {
  readonly root: string
  readonly system: string
  readonly oracles: string
  readonly evidence: string
  readonly analysis: string
  readonly obligations: string

  constructor(root: string, system: string) {
    this.root = resolve(root)
    this.system = system
    this.oracles = join(this.root, 'oracles', system)
    this.evidence = join(this.root, 'evidence', system)
    this.analysis = join(this.root, 'analysis', system)
    this.obligations = join(this.root, 'obligations', system)
  }

  casePath(id: string) { return join(this.oracles, 'cases', `${id}.json`) }
  case(id: string) { return load(this.casePath(id)) }
  setPath(name: string) { return join(this.oracles, 'sets', `${name}.json`) }
}

// ---------------------------------------------------------------------------
// Exact decimals (BigInt with a scale). Never floats.
// ---------------------------------------------------------------------------

type Dec = { n: bigint; s: number }

export function dec(v: unknown): Dec | null {
  if (typeof v === 'number' && Number.isInteger(v)) return { n: BigInt(v), s: 0 }
  if (typeof v !== 'string') return null
  const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(v)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null
  const frac = m[3] ?? ''
  const n = BigInt((m[2] || '0') + frac)
  return { n: m[1] === '-' ? -n : n, s: frac.length }
}

const align = (a: Dec, b: Dec): [bigint, bigint, number] => {
  const s = Math.max(a.s, b.s)
  return [a.n * 10n ** BigInt(s - a.s), b.n * 10n ** BigInt(s - b.s), s]
}

const decAdd = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { n: x + y, s } }
const decAbsDiff = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { n: x > y ? x - y : y - x, s } }
const decCmp = (a: Dec, b: Dec): number => { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0 }

export function decStr(d: Dec): string {
  const neg = d.n < 0n
  const digits = (neg ? -d.n : d.n).toString().padStart(d.s + 1, '0')
  const body = d.s === 0 ? digits : `${digits.slice(0, -d.s)}.${digits.slice(-d.s)}`
  return (neg ? '-' : '') + body
}

// ---------------------------------------------------------------------------
// Cases and sets (§6.1, §5.3)
// ---------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/

function isoDate(clock: string): { y: number; m: number; d: number } | null {
  const m = ISO.exec(clock)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  return { y, m: mo, d }
}

/** Every input to the unit is part of the case: records, parameters, clock, store snapshots, session. */
export function canonicalInput(inp: Obj): Obj {
  if (inp === null || typeof inp !== 'object' || Array.isArray(inp)) throw new Bad('canonical input must be an object')
  const missing = INPUT_KEYS.filter((k) => !(k in inp))
  if (missing.length > 0) {
    throw new Bad(`canonical input lacks ${JSON.stringify(missing)}: a case must include every input (use null or {} for none)`)
  }
  const extra = Object.keys(inp).filter((k) => !(INPUT_KEYS as readonly string[]).includes(k)).sort()
  if (extra.length > 0) throw new Bad(`canonical input has unknown keys ${JSON.stringify(extra)}`)
  if (inp['clock'] !== null && (typeof inp['clock'] !== 'string' || !isoDate(inp['clock']))) {
    throw new Bad(`clock must be an ISO date-time, got ${JSON.stringify(inp['clock'])}`)
  }
  return inp
}

export const caseId = (inp: Obj): string => sha(canon(canonicalInput(inp)))

export function addCase(ws: WS, inp: Obj, classes: string[], origin: string, expected: Obj | null): Obj {
  const id = caseId(inp)
  const p = ws.casePath(id)
  let c: Obj
  if (isFile(p)) {
    c = load(p)
    c['classes'] = uniqSorted([...c['classes'], ...classes])
    if (expected !== null && c['expected'] !== null && canon(c['expected']) !== canon(expected)) {
      throw new Bad(`case ${id.slice(0, 12)} already has a different expected output`)
    }
    if (expected !== null) c['expected'] = expected
  } else {
    c = { id, input: inp, expected, classes: uniqSorted(classes), origin }
  }
  dump(p, c)
  return c
}

/** Split a pool into dev and sealed by input hash. Sealed cases never move (§5.3 rule 2). */
/**
 * `exhaustive` names classes whose whole input domain is already in the pool (for example the one empty input).
 * They cannot draw fresh inputs, so they are exempt from the fresh-input rules; their cases re-run every time instead.
 */
export function buildSet(ws: WS, name: string, gateUnit: string, mode: string, pool: string[],
                         required: Record<string, string>, generators: Record<string, string>, exhaustive: string[] = []): Obj {
  if (mode !== 'executable' && mode !== 'recorded') throw new Bad('mode must be executable or recorded')
  const p = ws.setPath(name)
  const old = isFile(p) ? load(p) : null
  const sealed = new Set<string>(old ? old['sealed'] : [])
  const dev = new Set<string>(old ? old['dev'] : [])
  for (const id of pool) {
    const c = ws.case(id)
    if (mode === 'recorded' && c['expected'] === null) {
      throw new Bad(`recorded mode: case ${id.slice(0, 12)} has no recorded expected output`)
    }
  }
  const fresh = uniqSorted(pool.filter((id) => !sealed.has(id) && !dev.has(id)))
  const total = sealed.size + dev.size + fresh.length
  const share = Math.ceil(total * SEALED_SHARE)
  const want = mode === 'executable' ? Math.max(SEALED_MIN, share) : share
  for (const id of fresh) (sealed.size < want ? sealed : dev).add(id) // sorted by hash: nobody chooses
  if (mode === 'executable' && sealed.size < SEALED_MIN) {
    throw new Bad(`executable mode needs at least ${SEALED_MIN} sealed cases; the pool gives ${sealed.size}`)
  }
  const s = {
    name, gate_unit: gateUnit, mode, dev: uniqSorted(dev), sealed: uniqSorted(sealed),
    required_classes: sortObj(required), generators: sortObj(generators),
    exhaustive_classes: uniqSorted([...(old?.['exhaustive_classes'] ?? []), ...exhaustive]),
    failed_classes: old ? old['failed_classes'] ?? [] : [],
  }
  dump(p, s)
  return s
}

const sortObj = <T,>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]!]))

/** Case ids and generator definitions only. Never per-run seeds (§6.5). */
export const setHash = (s: Obj): string =>
  sha(canon({ dev: s['dev'], sealed: s['sealed'], generators: s['generators'], exhaustive: s['exhaustive_classes'] ?? [] }))

// ---------------------------------------------------------------------------
// Observations and the built-in comparator
// ---------------------------------------------------------------------------
//
// Observations of one run of one case:
//   {"stores": {"<store>": {"records": [{"<field>": "<value>"}, ...]}},
//    "return_code": 0, "abend": null, "messages": ["..."], "screens": [{...}]}
// Values are strings. A decimal is "123.40", never a float.

export function applyNormalizers(obs: Obj, norms: Obj[]): Obj {
  const o = structuredClone(obs)
  for (const n of norms) {
    const recs: Obj[] | undefined = n['store'] ? o['stores']?.[n['store']]?.['records'] : undefined
    if (n['erases'] === 'order' && recs) recs.sort((a, b) => (canon(a) < canon(b) ? -1 : canon(a) > canon(b) ? 1 : 0))
    else if (n['erases'] === 'field' && recs) for (const r of recs) if (n['field'] in r) r[n['field']] = '<masked>'
    // 'encoding' normalizers convert before observations are written; here they only gate legality
  }
  return o
}

/** One observable id, split: unit-level `{kind}`, or store-level `{store, kind, field?}`. */
function splitId(unit: string, id: string): { store?: string; kind: string; field?: string } {
  const problem = observableIdProblem(unit, id)
  if (problem) throw new Bad(`delta id ${JSON.stringify(id)}: ${problem}`)
  if (id.startsWith(unit + '.')) return { kind: id.slice(unit.length + 1) }
  const m = id.startsWith(unit + '/') ? STORE_KINDS_OBS.exec(id.slice(unit.length + 1)) : null
  if (!m) throw new Bad(`delta id ${JSON.stringify(id)} is not an observable id of ${unit} (see surface check)`)
  const kind = m[2]!
  return kind.startsWith('field:') ? { store: m[1]!, kind: 'field', field: kind.slice(6) } : { store: m[1]!, kind }
}

const UNIT_FIELD: Record<string, string> = { return_code: 'return_code', abend: 'abend', message: 'messages', screen: 'screens' }

function dropObservable(obs: Obj, unit: string, id: string): void {
  const x = splitId(unit, id)
  if (!x.store) { delete obs[UNIT_FIELD[x.kind] ?? x.kind]; return }
  const st = obs['stores']?.[x.store]
  if (!st) return
  if (x.kind === 'field') for (const r of st['records'] ?? []) delete r[x.field!]
  else if (x.kind === 'store_write') delete obs['stores'][x.store]
  else throw new Bad(`a delta cannot remove or add ${id} alone: remove the store (${unit}/${x.store}.store_write) or name a field`)
}

/**
 * Apply an approved delta (§6.7) before comparing: legacy observables it maps are renamed to their modern ids, the
 * ones it removes leave the legacy side, and the ones it adds leave the modern side. Everything else is compared as
 * it is. A store rename is a `store_write` mapping; a field rename is a `field:` mapping.
 */
export function applyDelta(legacy: Obj, modern: Obj, d: Obj, unit: string): { legacy: Obj; modern: Obj } {
  const l = structuredClone(legacy), m = structuredClone(modern)
  for (const id of d['removed'] ?? []) dropObservable(l, unit, id)
  for (const id of d['added'] ?? []) dropObservable(m, unit, id)
  const entries = Object.entries<string>(d['map'] ?? {})
  for (const [from, to] of entries) { // stores first, so a field mapping can name the renamed store
    const a = splitId(unit, from), b = splitId(unit, to)
    if (a.kind !== b.kind) throw new Bad(`delta maps ${from} to ${to}: a mapping keeps the kind of observable`)
    if (a.kind === 'store_write' && a.store !== b.store && l['stores']?.[a.store!]) {
      l['stores'][b.store!] = l['stores'][a.store!]
      delete l['stores'][a.store!]
    }
  }
  for (const [from, to] of entries) {
    const a = splitId(unit, from), b = splitId(unit, to)
    if (a.kind !== 'field' || a.field === b.field) continue
    for (const r of l['stores']?.[b.store!]?.['records'] ?? []) {
      if (a.field! in r) { r[b.field!] = r[a.field!]; delete r[a.field!] }
    }
  }
  return { legacy: l, modern: m }
}

/** Approved deltas only: a delta nobody approved changes nothing it compares (§11 gate 5). */
export function approvedDeltas(paths: string[]): Obj[] {
  return paths.map((p) => {
    const d = load(p)
    if (!d['approved_by']) throw new Bad(`delta ${p} is not approved (approved_by); run /rig:review <system> normalizers`)
    return d
  })
}

const withDeltas = (legacy: Obj, modern: Obj, deltas: Obj[], unit: string) =>
  deltas.reduce((acc, d) => applyDelta(acc.legacy, acc.modern, d, unit), { legacy, modern })

/** The name a gate unit's observable ids start with: `job:INTCALC` → `INTCALC`, `http:GET /owners` → `GET /owners`. */
export const unitName = (gateUnit: string): string => gateUnit.includes(':') ? gateUnit.slice(gateUnit.indexOf(':') + 1) : gateUnit

const UNIT_KINDS = new Set(['return_code', 'abend', 'message', 'screen', 'timing'])
const STORE_KINDS_OBS = /^(.+)\.(store_write|cardinality|record_order|store_semantics|field:[^\s:]+)$/

/**
 * Why an observable id is not one the comparator records, or null when it is. The grammar is exactly what
 * exactCompare emits: `<U>.<kind>` for unit-level kinds, `<U>/<store>.<kind>` and `<U>/<store>.field:<name>`
 * for store-level ones. A scenario label (`screen:200-html-list`) is not part of an id; it goes in `scenarios`.
 */
export function observableIdProblem(gateUnit: string, id: string): string | null {
  const u = unitName(gateUnit)
  if (id.startsWith(u + '.')) {
    const kind = id.slice(u.length + 1)
    if (UNIT_KINDS.has(kind)) return null
    const base = kind.split(':')[0]!
    if (UNIT_KINDS.has(base)) return `"${kind}" carries a suffix; the comparator records ${u}.${base} (put the label in "scenarios")`
    return `unknown unit-level kind "${kind}" (one of ${[...UNIT_KINDS].join(', ')})`
  }
  if (id.startsWith(u + '/')) {
    if (STORE_KINDS_OBS.test(id.slice(u.length + 1))) return null
    return `store-level ids are ${u}/<store>.store_write|cardinality|record_order|store_semantics|field:<name>`
  }
  return `ids of ${gateUnit} start with "${u}." or "${u}/"`
}

export type Comparison = { equal: boolean; compared: string[]; diffs: string[] }

/** Compare every observable. Cardinality and order are separate observables. */
export function exactCompare(legacy: Obj, modern: Obj, unit: string, tolerances: Record<string, Dec> = {}): Comparison {
  const compared: string[] = []
  const diffs: string[] = []
  const cmp = (oid: string, a: unknown, b: unknown) => {
    compared.push(oid)
    if (canon(a) !== canon(b)) diffs.push(oid)
  }
  cmp(`${unit}.return_code`, legacy['return_code'] ?? null, modern['return_code'] ?? null)
  cmp(`${unit}.abend`, legacy['abend'] ?? null, modern['abend'] ?? null)
  if (legacy['messages'] != null || modern['messages'] != null) cmp(`${unit}.message`, legacy['messages'] ?? null, modern['messages'] ?? null)
  if (legacy['screens'] != null || modern['screens'] != null) cmp(`${unit}.screen`, legacy['screens'] ?? null, modern['screens'] ?? null)
  const ls: Obj = legacy['stores'] ?? {}
  const ms: Obj = modern['stores'] ?? {}
  for (const store of uniqSorted([...Object.keys(ls), ...Object.keys(ms)])) {
    const base = `${unit}/${store}`
    const a0: Obj[] | undefined = ls[store]?.['records']
    const b0: Obj[] | undefined = ms[store]?.['records']
    cmp(`${base}.store_write`, a0 !== undefined, b0 !== undefined)
    const a = a0 ?? [], b = b0 ?? []
    cmp(`${base}.cardinality`, a.length, b.length)
    cmp(`${base}.record_order`, a.map(canon), b.map(canon))
    for (const f of uniqSorted([...a, ...b].flatMap((r) => Object.keys(r)))) {
      const oid = `${base}.field:${f}`
      const tol = tolerances[oid]
      if (tol && a.length === b.length) {
        compared.push(oid)
        const bad = a.some((r, i) => {
          const x = dec(r[f]), y = dec(b[i]![f])
          return !x || !y || decCmp(decAbsDiff(x, y), tol) > 0
        })
        if (bad) diffs.push(oid)
        continue
      }
      // A value with the rest of its record, as a multiset: a reorder alone shows in record_order,
      // a value moved between records shows here.
      const pairs = (rs: Obj[]) => rs.map((r) => canon([r[f] ?? null, Object.fromEntries(Object.entries(r).filter(([k]) => k !== f))])).sort()
      cmp(oid, pairs(a), pairs(b))
    }
  }
  return { equal: diffs.length === 0, compared: uniqSorted(compared), diffs: uniqSorted(diffs) }
}

/** `exact` (built in) or a command `<cmd> legacy.json modern.json` that prints {equal, compared}. */
export function runComparator(spec: string | undefined, legacy: Obj, modern: Obj, unit: string, tmp: string): Comparison {
  if (!spec || spec === 'exact') return exactCompare(legacy, modern, unit)
  mkdirSync(tmp, { recursive: true })
  const la = join(tmp, `l-${randomUUID()}.json`)
  const mb = join(tmp, `m-${randomUUID()}.json`)
  writeFileSync(la, canon(legacy))
  writeFileSync(mb, canon(modern))
  const [cmd, ...args] = spec.split(/\s+/).filter(Boolean)
  let out
  try {
    out = spawnSync(cmd!, [...args, la, mb], { encoding: 'utf8', timeout: 120_000 })
  } finally {
    for (const f of [la, mb]) try { unlinkSync(f) } catch { /* gone */ }
  }
  let r: Obj
  try {
    r = JSON.parse(out.stdout)
  } catch {
    throw new Bad(`comparator ${JSON.stringify(spec)} did not print JSON: ${(out.stderr ?? '').slice(0, 200)}`)
  }
  if (!Array.isArray(r['compared'])) throw new Bad('a comparator must report the observables it compared (Rule B)')
  return { equal: Boolean(r['equal']), compared: [...r['compared']].sort(), diffs: r['diffs'] ?? [] }
}

// ---------------------------------------------------------------------------
// Calendar (§6.6)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const MINIMUM_WINDOW = ['weekday_mon', 'weekday_tue', 'weekday_wed', 'weekday_thu', 'weekday_fri',
  'month_end_30', 'month_end_31', 'month_end_feb', 'quarter_end']

export function calendarEvents(clock: string | null | undefined, params: Obj | null = null): string[] {
  if (!clock) return []
  const d = isoDate(clock)
  if (!d) return []
  const date = new Date(Date.UTC(d.y, d.m - 1, d.d))
  const ev = [`weekday_${WEEKDAYS[(date.getUTCDay() + 6) % 7]}`]
  const last = new Date(Date.UTC(d.y, d.m, 0)).getUTCDate()
  if (d.d === last) {
    ev.push(d.m === 2 ? 'month_end_feb' : `month_end_${last}`)
    if ([3, 6, 9, 12].includes(d.m)) ev.push('quarter_end')
    if (d.m === 12) ev.push('year_end')
  }
  if (d.m === 2 && d.d === 29) ev.push('leap_day')
  for (const k of Object.keys(params ?? {}).sort()) {
    if (k.toLowerCase().startsWith('run_mode') || ['PARM-CYCLE', 'CYCLE', 'RUN-MODE'].includes(k.toUpperCase())) {
      ev.push(`run_mode_${params![k]}`)
    }
  }
  return ev
}

// ---------------------------------------------------------------------------
// Judge (§5.3)
// ---------------------------------------------------------------------------

type Coverage = { observables: Record<string, number>; classes: Record<string, number>; hazards: Record<string, number>
  calendar_events: string[]; mismatches: string[] }

const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }

/** Compare every case of the run, write the run with its coverage, and return counts per class only. */
export function judge(ws: WS, setName: string, key: string, legacyDir: string, modernDir: string, freshIn: string[],
                      comparator: string | undefined, normalizers: Obj[], envId: string, deltas: Obj[] = []): Obj {
  const s = load(ws.setPath(setName))
  const unit = unitName(String(s['gate_unit']))
  const known = new Set<string>([...s['dev'], ...s['sealed']])
  const fresh = uniqSorted(freshIn.filter((id) => !known.has(id)))
  const cases = uniqSorted([...known, ...fresh])
  // A class that failed last time must come back with new inputs (§5.3 rule 3).
  const freshClasses = new Set(fresh.flatMap((id) => ws.case(id)['classes'] as string[]))
  const exhaustive = new Set<string>(s['exhaustive_classes'] ?? [])
  const missingRetry = (s['failed_classes'] as string[] ?? []).filter((c) => !freshClasses.has(c) && !exhaustive.has(c)).sort()
  if (missingRetry.length > 0) throw new Bad(`classes that failed last run need fresh inputs this run: ${JSON.stringify(missingRetry)}`)

  const results: Obj[] = []
  const coverage: Coverage = { observables: {}, classes: {}, hazards: {}, calendar_events: [], mismatches: [] }
  const tmp = join(ws.evidence, '.tmp')
  for (const id of cases) {
    const c = ws.case(id)
    const lpath = join(legacyDir, `${id}.json`)
    const mpath = join(modernDir, `${id}.json`)
    if (!isFile(mpath)) throw new Bad(`no modern observation for case ${id.slice(0, 12)}`)
    const modern = load(mpath)
    const legacy = isFile(lpath) ? load(lpath) : c['expected'] ?? null // null: recorded mode, generated input
    let r: Obj
    if (legacy === null) {
      // No legacy output exists, so only properties that need none are checked. An abend is behaviour the
      // legacy may share; only a crash (an unhandled failure of the modern code) fails (§6.1).
      const ok = (modern['crash'] ?? null) === null
      r = { case: id, classes: c['classes'], pass: ok, compared: [], property_only: true }
    } else {
      const d = withDeltas(applyNormalizers(legacy, normalizers), applyNormalizers(modern, normalizers), deltas, unit)
      const cmpd = runComparator(comparator, d.legacy, d.modern, unit, tmp)
      // Its ids must be the surface grammar, or coverage silently misses every surface id (M5 exit run: judge passed
      // 67/67 and the verdict then said "never compared").
      const badIds = cmpd.compared.map((id) => [id, observableIdProblem(unit, id)]).filter(([, p]) => p !== null)
      if (badIds.length > 0) throw new Bad(`comparator ${JSON.stringify(comparator ?? 'exact')} reports ids outside the observable id grammar: ${badIds.slice(0, 3).map(([id, p]) => `${id} (${p})`).join('; ')}`)
      r = { case: id, classes: c['classes'], pass: cmpd.equal, compared: cmpd.compared }
      for (const oid of cmpd.compared) bump(coverage.observables, oid)
    }
    r['fresh'] = fresh.includes(id)
    results.push(r)
    for (const cl of c['classes'] as string[]) {
      bump(coverage.classes, cl)
      if (cl.startsWith('hazard:')) bump(coverage.hazards, cl.slice(7))
    }
    coverage.calendar_events.push(...calendarEvents(c['input']['clock'], c['input']['params']))
    if (!r['pass']) coverage.mismatches.push(id)
  }
  coverage.calendar_events = uniqSorted(coverage.calendar_events)

  const runId = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + '-' + randomUUID().replaceAll('-', '').slice(0, 6)
  dump(join(ws.evidence, key, runId, 'run.json'), {
    run_id: runId, key, set: setName, gate_unit: s['gate_unit'], mode: s['mode'], environment: envId,
    deltas: deltas.map((d) => d['id'] ?? null), results, coverage,
  })

  // Failing fresh inputs join the sealed set for good (§5.3 rule 4). Sealed cases never move.
  const failedFresh = results.filter((r) => r['fresh'] && !r['pass']).map((r) => r['case'] as string)
  s['sealed'] = uniqSorted([...s['sealed'], ...failedFresh])
  for (const id of failedFresh) dump(ws.casePath(id), { ...ws.case(id), origin: 'fresh_failure' })
  s['failed_classes'] = uniqSorted(results.filter((r) => !r['pass']).flatMap((r) => r['classes'] as string[]))
  dump(ws.setPath(setName), s)

  const counts = new Map<string, { class: string; description: string; passed: number; total: number }>()
  for (const r of results) {
    for (const cl of r['classes'] as string[]) {
      const k = counts.get(cl) ?? { class: cl, description: s['required_classes'][cl] ?? '', passed: 0, total: 0 }
      k.total++
      if (r['pass']) k.passed++
      counts.set(cl, k)
    }
  }
  // Counts and class descriptions only: never an input, an expected output, or a diff.
  return { run_id: runId, classes: [...counts.values()].sort((a, b) => a.class.localeCompare(b.class)),
           passed: results.filter((r) => r['pass']).length, total: results.length }
}

/**
 * Self-check (§5.2): compare the observations of the given cases and return counts per class. Nothing is recorded: a
 * self-check is not evidence. Cases are files `<case-id>.json` holding {input, expected, classes}, as handed to a worker.
 */
export function compareOnly(casesDir: string, modernDir: string, comparator: string | undefined, unit: string, tmp: string, deltas: Obj[] = []): Obj {
  const counts = new Map<string, { class: string; passed: number; total: number }>()
  let passed = 0, total = 0
  for (const f of ls(casesDir).filter((x) => x.endsWith('.json'))) {
    const c = load(join(casesDir, f))
    const mpath = join(modernDir, f)
    if (!isFile(mpath)) throw new Bad(`no modern observation for ${f}`)
    if (c['expected'] == null) continue
    const d = withDeltas(c['expected'], load(mpath), deltas, unit)
    const ok = runComparator(comparator, d.legacy, d.modern, unit, tmp).equal
    total++
    if (ok) passed++
    for (const cl of (c['classes'] ?? ['unclassified']) as string[]) {
      const k = counts.get(cl) ?? { class: cl, passed: 0, total: 0 }
      k.total++
      if (ok) k.passed++
      counts.set(cl, k)
    }
  }
  return { passed, total, classes: [...counts.values()].sort((a, b) => a.class.localeCompare(b.class)) }
}

// ---------------------------------------------------------------------------
// Evidence keys (§6.5)
// ---------------------------------------------------------------------------

const FOLLOW = new Set(['contains', 'runs', 'expands', 'includes', 'calls', 'transfers', 'links', 'starts', 'entry',
  'has_record', 'uses_psb', 'uses', 'maps_to', 'reads', 'writes', 'binds', 'accesses_unknown', 'submits'])
const STORE_KINDS = new Set(['dataset', 'table', 'mq_queue', 'td_queue', 'external', 'sysout'])

/** Gate-unit prefixes and the graph node kind each one names (`tx:CC00` is the node `transaction:CC00`). */
const GATE_NODE_KIND: Record<string, string> = { job: 'job', tx: 'transaction', http: 'endpoint' }

/**
 * The graph node a gate unit starts from. Rule A: a gate unit with no node fails closed, because an empty closure
 * would give a key that hashes no legacy file and stays the same whatever the legacy code is (M4 exit run).
 */
export function gateNode(g: Obj, gateUnit: string): string {
  const ids = new Set<string>(g['nodes'].map((n: Obj) => n['id']))
  const i = gateUnit.indexOf(':')
  const kind = GATE_NODE_KIND[gateUnit.slice(0, i)]
  if (i < 0 || !kind) throw new Bad(`gate unit ${gateUnit} must start with job:, tx: or http:`)
  const id = `${kind}:${gateUnit.slice(i + 1)}`
  if (ids.has(id)) return id
  if (ids.has(gateUnit)) return gateUnit
  throw new Bad(`gate unit ${gateUnit} has no node ${id} in graph.json; the key would hash no legacy file`)
}

/** Legacy files in the gate unit's runtime closure, from graph.json. Stores are the boundary. */
export function runtimeClosure(ws: WS, gateUnit: string): string[] {
  const g = load(join(ws.analysis, 'graph.json'))
  const out = new Map<string, Obj[]>()
  for (const e of g['edges']) out.set(e['from'], [...(out.get(e['from']) ?? []), e])
  const nodes = new Map<string, Obj>(g['nodes'].map((n: Obj) => [n['id'], n]))
  const start = gateNode(g, gateUnit)
  const stack = [start, ...g['edges'].filter((e: Obj) => e['kind'] === 'schedules' && e['to'] === start).map((e: Obj) => e['from'])]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    if (STORE_KINDS.has(id.split(':')[0]!)) continue
    for (const e of out.get(id) ?? []) if (FOLLOW.has(e['kind'])) stack.push(e['to'])
  }
  const files = new Set<string>()
  for (const id of seen) {
    const n = nodes.get(id) ?? {}
    const loc: string | null | undefined = n['loc']
    files.add(loc ? loc.slice(0, loc.lastIndexOf(':') < 0 ? undefined : loc.lastIndexOf(':')) : `<node ${id} ${n['attrs']?.['source'] ?? ''}>`)
  }
  return [...files].sort()
}

function hashFiles(paths: string[], base: string): string {
  const h = createHash('sha256')
  for (const p of [...paths].sort()) {
    h.update(p + '\0')
    const fp = join(base, p)
    h.update(p.startsWith('<') || !isFile(fp) ? '<absent>' : readFileSync(fp))
    h.update('\0')
  }
  return h.digest('hex')
}

/** A normalizer or delta file, plus the consumer lists it relies on, so a new consumer invalidates it. */
function comparatorMaterial(ws: WS, path: string): Obj {
  const p = join(ws.root, path)
  const body = isFile(p) ? readFileSync(p, 'utf8') : `<absent ${path}>`
  let consumers: Obj | null = null
  if (p.endsWith('.json') && isFile(p)) {
    const surf = JSON.parse(body)['surface']
    if (surf && isFile(join(ws.root, surf))) {
      consumers = Object.fromEntries(load(join(ws.root, surf))['observables'].map((o: Obj) => [o['id'], o['consumers'] ?? null]))
    }
  }
  return { path, body: sha(body), consumers }
}

export function evidenceKey(ws: WS, gateUnit: string, rung: string, legacyRoot: string, modern: string[],
                            oracleSet: string | undefined, comparators: string[], packs: Obj, environment: Obj): Obj {
  if (!RUNGS.includes(rung)) throw new Bad(`rung must be one of ${RUNGS.join(', ')}`)
  const closure = runtimeClosure(ws, gateUnit)
  const fields = {
    gate_unit: gateUnit,
    rung,
    runtime_closure: sha(hashFiles(closure, legacyRoot) + hashFiles(modern, ws.root)),
    oracle: ORACLE_RUNGS.has(rung) && oracleSet ? setHash(load(ws.setPath(oracleSet))) : null,
    comparators: COMPARATOR_RUNGS.has(rung) ? sha(canon([...comparators].sort().map((c) => comparatorMaterial(ws, c)))) : null,
    packs: sha(canon(packs)),
    environment: sha(canon(environment)),
  }
  return { key: sha(canon(fields)).slice(0, 32), fields, closure }
}

// ---------------------------------------------------------------------------
// Normalizers and deltas (§6.2, §6.3, §6.7)
// ---------------------------------------------------------------------------

/** EBCDIC code pages this script can round-trip itself (cp037 table built in). */
const CP037 = (() => {
  // IBM037 to Unicode, 256 entries, from the published code page.
  const t = '00 01 02 03 9c 09 86 7f 97 8d 8e 0b 0c 0d 0e 0f 10 11 12 13 9d 85 08 87 18 19 92 8f 1c 1d 1e 1f 80 81 82 83 84 0a 17 1b 88 89 8a 8b 8c 05 06 07 90 91 16 93 94 95 96 04 98 99 9a 9b 14 15 9e 1a 20 a0 e2 e4 e0 e1 e3 e5 e7 f1 a2 2e 3c 28 2b 7c 26 e9 ea eb e8 ed ee ef ec df 21 24 2a 29 3b ac 2d 2f c2 c4 c0 c1 c3 c5 c7 d1 a6 2c 25 5f 3e 3f f8 c9 ca cb c8 cd ce cf cc 60 3a 23 40 27 3d 22 d8 61 62 63 64 65 66 67 68 69 ab bb f0 fd fe b1 b0 6a 6b 6c 6d 6e 6f 70 71 72 aa ba e6 b8 c6 a4 b5 7e 73 74 75 76 77 78 79 7a a1 bf d0 dd de ae 5e a3 a5 b7 a9 a7 b6 bc bd be 5b 5d af a8 b4 d7 7b 41 42 43 44 45 46 47 48 49 ad f4 f6 f2 f3 f5 7d 4a 4b 4c 4d 4e 4f 50 51 52 b9 fb fc f9 fa ff 5c f7 53 54 55 56 57 58 59 5a b2 d4 d6 d2 d3 d5 30 31 32 33 34 35 36 37 38 39 b3 db dc d9 da 9f'
  return t.split(' ').map((h) => parseInt(h, 16))
})()
const ENCODINGS: Record<string, number[]> = { cp037: CP037 }

export function checkNormalizer(ws: WS, n: Obj): string[] {
  const errs: string[] = []
  if (!n['approved_by']) errs.push('no human approval (approved_by)')
  const surf = n['surface'] && isFile(join(ws.root, n['surface'])) ? load(join(ws.root, n['surface'])) : null
  const target = (surf?.['observables'] ?? []).find((o: Obj) => o['id'] === n['observable'])
  if (!target) {
    errs.push(`observable ${JSON.stringify(n['observable'])} is not on the surface ${JSON.stringify(n['surface'])}`)
    return errs
  }
  const erases = n['erases']
  if (erases === 'order' || erases === 'field') {
    const cons = target['consumers'] ?? {}
    if (cons['complete'] !== true) errs.push('consumer list is not complete, so an unknown consumer depends on everything (Rule A)')
    const aspect = erases === 'order' ? 'record_order' : `field:${n['field']}`
    for (const ext of cons['external'] ?? []) {
      const dep: string[] = ext['depends_on']?.length ? ext['depends_on'] : ['*']
      if (dep.some((d) => d === '*' || d === aspect || (d === 'field:*' && erases === 'field'))) {
        errs.push(`external consumer ${ext['name']} depends on ${aspect}`)
      }
    }
    const evidence = n['consumer_evidence'] ?? {}
    for (const ic of cons['internal'] ?? []) {
      if (!(ic in evidence)) errs.push(`internal consumer ${ic} has no cited evidence that it does not depend on ${aspect}`)
    }
  } else if (erases === 'tolerance') {
    const t = String(target['type'] ?? '')
    if (!t.startsWith('float')) errs.push(`tolerance on ${t}: only floating-point observables whose legacy type is floating point may have one`)
  } else if (erases === 'encoding') {
    const table = ENCODINGS[n['encoding']]
    if (!table) errs.push(`unknown encoding ${JSON.stringify(n['encoding'])}; known: ${Object.keys(ENCODINGS).join(', ')}`)
    else if (new Set(table).size !== 256) errs.push('encoding round trip is lossy')
  } else {
    errs.push(`unknown normalizer kind erases=${JSON.stringify(erases)}`)
  }
  return errs
}

export function checkDelta(ws: WS, d: Obj, legacyIds: string[], modernIds: string[]): string[] {
  const errs: string[] = []
  const map: Obj = d['map'] ?? {}
  const removed = new Set<string>(d['removed'] ?? [])
  const added = new Set<string>(d['added'] ?? [])
  for (const id of legacyIds) if (!(id in map) && !removed.has(id)) errs.push(`legacy observable ${id} is neither mapped nor removed`)
  const targets = new Set(Object.values(map))
  for (const id of modernIds) if (!targets.has(id) && !added.has(id)) errs.push(`modern observable ${id} is neither mapped nor added`)
  if (!d['approved_by']) errs.push('no human approval (approved_by)')
  // Every open obligation on the delta's legacy observables must be mapped to the new units (§6.7).
  const omap: Obj = d['obligations_map'] ?? {}
  for (const ob of loadObligations(ws)) {
    if (ob['status'] === 'discharged') continue
    if ((ob['observables'] as string[]).some((o) => legacyIds.includes(o)) && !(ob['id'] in omap)) {
      errs.push(`open obligation ${ob['id']} is not mapped to the new units`)
    }
  }
  return errs
}

// ---------------------------------------------------------------------------
// Canary sweep (§6.3)
// ---------------------------------------------------------------------------

function bumpValue(v: string): string {
  const d = dec(v)
  if (d) {
    const out = decStr({ n: d.n + 1n, s: d.s })
    return /^0\d/.test(v) && !v.includes('.') ? out.padStart(v.length, '0') : out
  }
  return v ? v.slice(0, -1) + (v.at(-1) !== 'A' ? 'A' : 'B') : 'X'
}

function reprVariants(v: string): [string, string][] {
  const out: [string, string][] = []
  if (/^0\d+$/.test(v)) out.push(['strip_padding', v.replace(/^0+/, '') || '0'])
  if (/^-?\d+\.\d*0$/.test(v)) out.push(['change_scale', v.replace(/0+$/, '').replace(/\.$/, '')])
  if (/^-\d+(\.\d+)?$/.test(v)) out.push(['sign_trailing', v.slice(1) + '-'])
  if (v.endsWith(' ') || v.startsWith(' ')) out.push(['trim', v.trim()])
  return out
}

type Mutation = [cls: string, desc: string, mutated: Obj]

/** Mutations of a list of lines or screen items: the structural, value and representation canaries. */
function listMutations(obs: Obj, field: 'messages' | 'screens', label: string): Mutation[] {
  const lines: unknown[] | undefined = obs[field]
  if (!Array.isArray(lines)) return []
  const out: Mutation[] = []
  const withLines = (nl: unknown[]) => ({ ...structuredClone(obs), [field]: nl })
  if (lines.length > 0) {
    out.push(['structural', `${label}: delete last item`, withLines(lines.slice(0, -1))])
    out.push(['structural', `${label}: duplicate an item`, withLines([...lines, structuredClone(lines.at(-1))])])
    out.push(['structural', `${label}: insert an item`, withLines([structuredClone(lines[0]), ...lines])])
    out.push(['structural', `${label}: empty the list`, withLines([])])
  }
  const i = lines.findIndex((x, k) => k > 0 && canon(x) !== canon(lines[0]))
  if (i > 0) {
    const swapped = [...lines]
    ;[swapped[0], swapped[i]] = [swapped[i], swapped[0]]
    out.push(['structural', `${label}: reorder items`, withLines(swapped)])
  }
  const k = lines.findIndex((x) => typeof x === 'string' && x.length > 0)
  if (k >= 0) {
    const s = lines[k] as string
    const set = (v: string) => { const nl = [...lines]; nl[k] = v; return withLines(nl) }
    out.push(['value', `${label}: change one character`, set(s.slice(0, -1) + (s.at(-1) === 'X' ? 'Y' : 'X'))])
    const mid = Math.floor(s.length / 2)
    out.push(['value', `${label}: change a character in the middle`, set(s.slice(0, mid) + (s[mid] === '0' ? '1' : '0') + s.slice(mid + 1))])
    if (/\s$/.test(s)) out.push(['representation', `${label}: strip trailing spaces`, set(s.trimEnd())])
    if (/^\s/.test(s)) out.push(['representation', `${label}: strip leading spaces`, set(s.trimStart())])
    const digits = /\d+/.exec(s)
    if (digits && digits[0].startsWith('0') && digits[0].length > 1) {
      out.push(['representation', `${label}: drop a leading zero`, set(s.slice(0, digits.index) + digits[0].slice(1) + s.slice(digits.index + digits[0].length))])
    }
  }
  const objIdx = lines.findIndex((x) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length > 0)
  if (objIdx >= 0) {
    const item = lines[objIdx] as Obj
    const f = Object.keys(item).sort()[0]!
    const nl = structuredClone(lines) as Obj[]
    nl[objIdx]![f] = typeof item[f] === 'string' ? bumpValue(item[f]) : 'X'
    out.push(['value', `${label}: change field ${f}`, withLines(nl)])
  }
  return out
}

/** (class, description, mutated observation). Each must make the comparator report a difference. */
export function canaryMutations(obs: Obj, correlated: Obj[]): Mutation[] {
  const out: Mutation[] = []
  const stores: Obj = obs['stores'] ?? {}
  for (const store of Object.keys(stores).sort()) {
    const recs: Obj[] = stores[store]['records'] ?? []
    const withRecs = (nr: Obj[]) => { const m = structuredClone(obs); m['stores'][store]['records'] = nr; return m }
    if (recs.length > 0) {
      out.push(['structural', `${store}: delete last record`, withRecs(recs.slice(0, -1))])
      out.push(['structural', `${store}: duplicate a record`, withRecs([...recs, structuredClone(recs.at(-1)!)])])
      out.push(['structural', `${store}: insert a record`, withRecs([structuredClone(recs[0]!), ...recs])])
      out.push(['structural', `${store}: empty the collection`, withRecs([])])
    }
    if (recs.length >= 2 && canon(recs[0]) !== canon(recs[1])) {
      out.push(['structural', `${store}: reorder records`, withRecs([recs[1]!, recs[0]!, ...recs.slice(2)])])
      const f = Object.keys(recs[0]!).sort().find((k) => recs[0]![k] !== recs[1]![k])
      if (f) {
        const r = structuredClone(recs)
        ;[r[0]![f], r[1]![f]] = [r[1]![f], r[0]![f]]
        out.push(['structural', `${store}: swap ${f} between two records`, withRecs(r)])
      }
    }
    for (const f of uniqSorted(recs.flatMap((r) => Object.keys(r)))) {
      const idx = recs.findIndex((r) => r[f] !== null && r[f] !== undefined && r[f] !== '')
      if (idx < 0) continue
      const v = String(recs[idx]![f])
      const setVal = (nv: unknown) => { const r = structuredClone(recs); r[idx]![f] = nv; return withRecs(r) }
      out.push(['value', `${store}.${f}: smallest change`, setVal(bumpValue(v))])
      const d = dec(v)
      if (d) {
        out.push(['value', `${store}.${f}: double`, setVal(decStr({ n: d.n * 2n, s: d.s }) === v ? decStr({ n: d.n + 1n, s: d.s }) : decStr({ n: d.n * 2n, s: d.s }))])
        out.push(['sign_zero', `${store}.${f}: negate`, setVal(d.n !== 0n ? decStr({ n: -d.n, s: d.s }) : '1')])
        out.push(['sign_zero', `${store}.${f}: zero`, setVal(d.n !== 0n ? '0' : '1')])
      }
      out.push(['sign_zero', `${store}.${f}: null`, setVal(null)])
      for (const [name, nv] of reprVariants(v)) out.push(['representation', `${store}.${f}: ${name}`, setVal(nv)])
    }
  }
  for (const g of correlated) { // {"store", "detail", "total"}: change one detail and recompute the total
    const recs: Obj[] = stores[g['store']]?.['records'] ?? []
    const d = recs.length > 0 ? dec(recs[0]![g['detail']]) : null
    if (!d) continue
    const r = structuredClone(recs)
    r[0]![g['detail']] = decStr(decAdd(d, { n: 1n, s: 0 }))
    for (const x of r) { const t = dec(x[g['total']]); if (t) x[g['total']] = decStr(decAdd(t, { n: 1n, s: 0 })) }
    const m = structuredClone(obs)
    m['stores'][g['store']]['records'] = r
    out.push(['correlated', `${g['store']}: ${g['detail']} changed with ${g['total']} recomputed`, m])
  }
  out.push(...listMutations(obs, 'messages', 'messages'))
  out.push(...listMutations(obs, 'screens', 'screens'))
  if ('return_code' in obs) out.push(['value', 'return_code changed', { ...structuredClone(obs), return_code: (obs['return_code'] ?? 0) + 4 }])
  out.push(['value', 'abend changed', { ...structuredClone(obs), abend: (obs['abend'] ?? null) === null ? 'S0C7' : null }])
  return out
}

export function canarySweep(samples: Obj[], comparator: string | undefined, unit: string, correlated: Obj[], tmp: string): Obj {
  const caught: string[] = []
  const missed: string[] = []
  const applied = new Set<string>()
  for (const obs of samples) {
    if (!runComparator(comparator, obs, obs, unit, tmp).equal) throw new Bad('the comparator reports a difference between identical observations')
    for (const [cls, desc, mutated] of canaryMutations(obs, correlated)) {
      applied.add(cls)
      let r: Comparison
      try {
        r = runComparator(comparator, obs, mutated, unit, tmp)
      } catch (e) { // a comparator that cannot read a canary cannot be trusted with real output
        missed.push(`${cls}: ${desc} (comparator failed: ${String((e as Error).message).slice(0, 80)})`)
        continue
      }
      ;(r.equal ? missed : caught).push(`${cls}: ${desc}`)
    }
  }
  const gaps: string[] = []
  if (![...caught, ...missed].some((c) => c.includes('reorder'))) {
    gaps.push('no sample has a store, message list or screen list with two different items, so the structural canaries could not all run')
  }
  return { trusted: missed.length === 0 && gaps.length === 0, caught: caught.length, missed, gaps, classes: [...applied].sort() }
}

// ---------------------------------------------------------------------------
// Obligations (§6.7)
// ---------------------------------------------------------------------------

export function loadObligations(ws: WS): Obj[] {
  return ls(ws.obligations).filter((f) => /^OBL-.*\.json$/.test(f)).map((f) => load(join(ws.obligations, f)))
}

export function* allRuns(ws: WS): Generator<Obj> {
  for (const key of ls(ws.evidence)) {
    for (const run of ls(join(ws.evidence, key))) {
      const p = join(ws.evidence, key, run, 'run.json')
      if (isFile(p)) yield load(p)
    }
  }
}

function exercises(r: Obj, run: Obj, requirement: string): boolean {
  const [kind, ...rest] = requirement.split(':')
  const name = rest.join(':')
  if (kind === 'calendar') return run['coverage']['calendar_events'].includes(name)
  return r['classes'].includes(requirement) || (kind === 'class' && r['classes'].includes(name))
}

/** An obligation is discharged only by runs that exercised its requirement on its observables (Rule B). */
export function discharge(ws: WS): Obj[] {
  const runs = [...allRuns(ws)]
  return loadObligations(ws).map((ob) => {
    let hits = 0, mismatches = 0
    const by = new Set<string>()
    for (const run of runs) {
      if (ob['exclude_environment'] && run['environment'] === ob['exclude_environment']) continue // the capped environment
      for (const r of run['results']) {
        if (!(ob['observables'] as string[]).some((o) => r['compared'].includes(o))) continue
        if (!exercises(r, run, ob['requirement'])) continue
        if (r['pass']) { hits++; by.add(run['run_id']) } else mismatches++
      }
    }
    const status = hits >= (ob['min_count'] ?? 1) && mismatches === 0 ? 'discharged' : 'open'
    const next = { ...ob, status, exercised: hits, mismatches, discharged_by: status === 'discharged' ? [...by].sort() : [] }
    dump(join(ws.obligations, `${ob['id']}.json`), next)
    return next
  })
}

// ---------------------------------------------------------------------------
// Oracle caps (§6.8): a person rules that the reference environment cannot be trusted for one class
// ---------------------------------------------------------------------------
//
// oracles/<system>/caps/CAP-*.json:
//   {"id", "gate_unit", "class", "environment", "observables", "reason", "signed_by", "signed_on"}
// A signed cap takes that class's comparisons in that environment out of pass and fail, and turns them into a gap that
// only evidence from another environment can discharge. An unsigned cap changes nothing.

export function loadCaps(ws: WS, gateUnit: string): { signed: Obj[]; unsigned: Obj[] } {
  const dir = join(ws.oracles, 'caps')
  const all = ls(dir).filter((f) => /^CAP-.*\.json$/.test(f)).map((f) => load(join(dir, f))).filter((c) => c['gate_unit'] === gateUnit)
  return { signed: all.filter((c) => c['signed_by']), unsigned: all.filter((c) => !c['signed_by']) }
}

const cappedBy = (caps: Obj[], r: Obj, env: string) =>
  caps.find((c) => c['environment'] === env && (r['classes'] as string[]).includes(c['class']))

// ---------------------------------------------------------------------------
// Verdicts (§6.5)
// ---------------------------------------------------------------------------

type Gap = { observables: string[]; requirement: string; reason: string; exclude_environment?: string }

/** PROVEN / PROVISIONAL / NOT_PROVEN / FLAKY from every run under the key. Reruns never clear a failure. */
export function verdict(ws: WS, gateUnit: string, rung: string, key: string, req: Obj, writeObligations: boolean): Obj {
  const keyDir = join(ws.evidence, key)
  const runs = ls(keyDir).map((r) => join(keyDir, r, 'run.json')).filter(isFile).map(load).filter((r) => r['gate_unit'] === gateUnit)
  if (runs.length === 0) {
    // Say what the latest run of this gate unit under another key found, so a stale key does not hide a failure.
    const other = [...allRuns(ws)].filter((r) => r['gate_unit'] === gateUnit && r['key'] !== key)
      .sort((x, y) => String(x['run_id']).localeCompare(String(y['run_id']))).at(-1)
    const reasons = ['no runs under the current key']
    if (other) reasons.push(`latest run under another key (${other['key']}): ${other['coverage']['mismatches'].length} of ${other['results'].length} case(s) failed`)
    return { verdict: 'NOT_PROVEN', reasons, gaps: [] }
  }
  const signoffs = new Map<string, Obj>()
  for (const f of ls(join(ws.evidence, 'signoffs'))) {
    if (f.endsWith('.json')) { const s = load(join(ws.evidence, 'signoffs', f)); signoffs.set(s['case'], s) }
  }
  const caps = loadCaps(ws, gateUnit)
  const capHits = new Map<string, { cap: Obj; cases: Set<string> }>()
  const outcomes = new Map<string, [boolean, string][]>()
  for (const run of runs) {
    for (const r of run['results']) {
      const cap = cappedBy(caps.signed, r, run['environment'])
      if (cap) { // the oracle cannot be trusted here: neither a pass nor a failure
        const h = capHits.get(cap['id']) ?? { cap, cases: new Set<string>() }
        h.cases.add(r['case'])
        capHits.set(cap['id'], h)
        continue
      }
      outcomes.set(r['case'], [...(outcomes.get(r['case']) ?? []), [r['pass'], run['environment']]])
    }
  }
  const capNote = caps.unsigned.length > 0 ? [`unsigned cap(s) ignored: ${caps.unsigned.map((c) => c['id']).join(', ')}`] : []
  if ([...outcomes.values()].reduce((n, v) => n + v.length, 0) === 0) {
    return { verdict: 'NOT_PROVEN', reasons: ['the runs executed zero cases'], gaps: [] }
  }
  const flaky: string[] = [], failed: string[] = [], infra: string[] = []
  for (const [id, res] of outcomes) {
    const passes = new Set(res.map(([p]) => p))
    if (passes.size === 2) {
      const s = signoffs.get(id)
      const envFail = new Set(res.filter(([p]) => !p).map(([, e]) => e))
      const envPass = new Set(res.filter(([p]) => p).map(([, e]) => e))
      const differ = [...envFail].some((e) => !envPass.has(e)) || [...envPass].some((e) => !envFail.has(e))
      if (s?.['signed_by'] && differ && new Set([...envFail, ...envPass]).size >= 2) { infra.push(id); continue }
      flaky.push(id)
    } else if (!passes.has(true)) failed.push(id)
  }
  if (flaky.length > 0) return { verdict: 'FLAKY', reasons: [`${flaky.length} case(s) both pass and fail under the same key`, ...capNote], cases: flaky.length, gaps: [] }
  if (failed.length > 0) return { verdict: 'NOT_PROVEN', reasons: [`${failed.length} case(s) fail under the current key`, ...capNote], gaps: [] }

  const cov = { observables: {} as Record<string, number>, classes: {} as Record<string, number>, hazards: {} as Record<string, number>, calendar: new Set<string>() }
  const freshByClass: Record<string, number> = {}
  for (const run of runs) {
    const c = run['coverage']
    for (const part of ['observables', 'classes', 'hazards'] as const) {
      for (const [k, v] of Object.entries(c[part] as Record<string, number>)) cov[part][k] = (cov[part][k] ?? 0) + v
    }
    for (const e of c['calendar_events']) cov.calendar.add(e)
    for (const r of run['results']) if (r['fresh'] && !r['property_only']) for (const cl of r['classes']) bump(freshByClass, cl)
  }
  const obsReq: string[] = req['observables'] ?? []
  const gaps: Gap[] = []
  for (const oid of obsReq) {
    const bad = observableIdProblem(gateUnit, oid)
    if (bad) gaps.push({ observables: [oid], requirement: 'class:any', reason: `observable ${oid} is not an id the comparator records: ${bad}` })
    else if ((cov.observables[oid] ?? 0) < 1) gaps.push({ observables: [oid], requirement: 'class:any', reason: `observable ${oid} was never compared` })
  }
  for (const [cl, n] of Object.entries((req['classes'] ?? {}) as Record<string, number>)) {
    if ((cov.classes[cl] ?? 0) < n) gaps.push({ observables: obsReq, requirement: `class:${cl}`, reason: `class ${cl}: ${cov.classes[cl] ?? 0} of ${n} inputs` })
  }
  const exhaustiveSets = new Set<string>()
  for (const run of runs) {
    const sp = ws.setPath(run['set'])
    if (isFile(sp)) for (const c of load(sp)['exhaustive_classes'] ?? []) exhaustiveSets.add(c)
  }
  for (const cl of ((req['fresh_classes'] ?? []) as string[]).filter((c) => !exhaustiveSets.has(c))) {
    if ((freshByClass[cl] ?? 0) < 1) gaps.push({ observables: obsReq, requirement: `class:${cl}`, reason: `class ${cl} had no fresh input compared against legacy` })
  }
  for (const hz of (req['hazards'] ?? []) as string[]) {
    if ((cov.hazards[hz] ?? 0) < 1) gaps.push({ observables: obsReq, requirement: `hazard:${hz}`, reason: `hazard ${hz} was never reached` })
  }
  for (const ev of (req['calendar_events'] ?? []) as string[]) {
    if (!cov.calendar.has(ev)) gaps.push({ observables: obsReq, requirement: `calendar:${ev}`, reason: `calendar event ${ev} not covered` })
  }
  for (const { cap, cases } of capHits.values()) {
    gaps.push({ observables: cap['observables'], requirement: `class:${cap['class']}`, exclude_environment: cap['environment'],
      reason: `${cap['id']}: class ${cap['class']} is capped in ${cap['environment']} (${cases.size} case(s) not counted); needs evidence from another environment` })
  }
  for (const cap of (req['capped'] ?? []) as Obj[]) { // reference fidelity (§6.8)
    gaps.push({ observables: cap['observables'], requirement: `hazard:${cap['hazard']}`, reason: `environment differs from production: ${cap['hazard']}` })
  }
  const recorded = runs.some((r) => r['mode'] === 'recorded')
  const obligations = loadObligations(ws)
  const matches = (o: Obj, g: Gap) => o['requirement'] === g.requirement && g.observables.every((x) => o['observables'].includes(x))
    && (o['exclude_environment'] ?? null) === (g.exclude_environment ?? null)
  if (writeObligations) {
    for (const g of gaps) {
      if (obligations.some((o) => matches(o, g))) continue
      const id = 'OBL-' + sha(canon([gateUnit, g.requirement, [...g.observables].sort(), g.exclude_environment ?? null])).slice(0, 8)
      const ob = { id, observables: [...g.observables].sort(), requirement: g.requirement, min_count: 1, reason: g.reason,
                   created_by: `${gateUnit} ${rung}`, accepted_by: null, status: 'open',
                   ...(g.exclude_environment ? { exclude_environment: g.exclude_environment } : {}) }
      dump(join(ws.obligations, `${id}.json`), ob)
      obligations.push(ob)
    }
  }
  const unaccepted = gaps.filter((g) => !obligations.some((o) => matches(o, g) && o['accepted_by']))
  const base = { runs: runs.length, cases: outcomes.size, infra_cleared: infra.length,
    capped: [...capHits.values()].map(({ cap, cases }) => ({ cap: cap['id'], class: cap['class'], cases: cases.size })), gaps }
  if (unaccepted.length > 0) return { ...base, verdict: 'NOT_PROVEN', reasons: [...unaccepted.map((g) => g.reason), ...capNote] }
  if (gaps.length > 0 || recorded) {
    const why = recorded && gaps.length === 0 ? ['recorded mode reaches PROVISIONAL at most'] : []
    return { ...base, verdict: 'PROVISIONAL', reasons: [...why, ...gaps.map((g) => g.reason), ...capNote] }
  }
  return { ...base, verdict: 'PROVEN', reasons: capNote }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ids = (v: string | undefined): string[] =>
  !v ? [] : v.startsWith('@') ? readFileSync(v.slice(1), 'utf8').split(/\s+/).filter(Boolean) : v.split(',').filter(Boolean)

export function main(argv: string[]): number {
  const { values: a, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: Object.fromEntries([
      'ws', 'system', 'input', 'expected', 'classes', 'origin', 'set', 'gate-unit', 'mode', 'pool', 'required', 'generators',
      'key', 'legacy-dir', 'modern-dir', 'fresh', 'comparator', 'normalizers', 'env', 'rung', 'legacy-root', 'modern',
      'comparators', 'packs', 'environment', 'file', 'legacy-ids', 'modern-ids', 'samples', 'correlated', 'requirements', 'derived', 'exhaustive', 'deltas', 'legacy-surface', 'modern-surface',
    ].map((k) => [k, { type: 'string' as const }]).concat([['write-obligations', { type: 'boolean' as const }], ['help', { type: 'boolean' as const }]])),
  })
  const [command, sub] = positionals
  if (a['help'] || !command) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); return 0 }
  const s = (k: string) => a[k] as string | undefined
  try {
    if (!s('system')) throw new Bad('--system is required')
    const ws = new WS(s('ws') ?? '.', s('system')!)
    let out: Obj
    let ok = true
    if (command === 'case' && sub === 'add') {
      const c = addCase(ws, load(s('input')!), ids(s('classes')), s('origin') ?? 'characterization', s('expected') ? load(s('expected')!) : null)
      out = { id: c['id'], classes: c['classes'] }
    } else if (command === 'set' && sub === 'build') {
      const st = buildSet(ws, s('set')!, s('gate-unit')!, s('mode')!, ids(s('pool')), s('required') ? load(s('required')!) : {}, s('generators') ? load(s('generators')!) : {}, ids(s('exhaustive')))
      out = { set: st['name'], dev: st['dev'].length, sealed: st['sealed'].length, hash: setHash(st) }
    } else if (command === 'compare') {
      // Self-check is not evidence: a draft delta may be tried here before a person approves it.
      out = compareOnly(s('legacy-dir')!, s('modern-dir')!, s('comparator'), unitName(String(s('gate-unit') ?? '')), join(ws.root, '.rig-tmp'), ids(s('deltas')).map(load))
      ok = out['passed'] === out['total']
    } else if (command === 'judge') {
      out = judge(ws, s('set')!, s('key')!, s('legacy-dir')!, s('modern-dir')!, ids(s('fresh')), s('comparator'), ids(s('normalizers')).map(load), s('env') ?? 'default', approvedDeltas(ids(s('deltas'))))
      ok = out['passed'] === out['total']
    } else if (command === 'key') {
      out = evidenceKey(ws, s('gate-unit')!, s('rung')!, s('legacy-root')!, ids(s('modern')), s('set'), ids(s('comparators')), JSON.parse(s('packs') ?? '{}'), JSON.parse(s('environment') ?? '{}'))
    } else if (command === 'normalizer') {
      const errs = checkNormalizer(ws, load(s('file')!))
      out = { legal: errs.length === 0, reasons: errs }
      ok = errs.length === 0
    } else if (command === 'delta') {
      const surfIds = (f: string | undefined, fallback: string[]) => f ? (load(f)['observables'] ?? []).map((o: Obj) => String(o['id'])) : fallback
      const errs = checkDelta(ws, load(s('file')!), surfIds(s('legacy-surface'), ids(s('legacy-ids'))), surfIds(s('modern-surface'), ids(s('modern-ids'))))
      out = { total: errs.length === 0, reasons: errs }
      ok = errs.length === 0
    } else if (command === 'canary') {
      out = canarySweep(ids(s('samples')).map(load), s('comparator'), unitName(String(s('gate-unit') ?? '')), JSON.parse(s('correlated') ?? '[]'), join(ws.evidence, '.tmp'))
      ok = out['trusted']
    } else if (command === 'verdict') {
      out = verdict(ws, s('gate-unit')!, s('rung')!, s('key')!, s('requirements') ? load(s('requirements')!) : {}, Boolean(a['write-obligations']))
      ok = out['verdict'] === 'PROVEN' || out['verdict'] === 'PROVISIONAL'
    } else if (command === 'obligations') {
      const obs = discharge(ws)
      out = { open: obs.filter((o) => o['status'] === 'open').map((o) => o['id']), discharged: obs.filter((o) => o['status'] === 'discharged').map((o) => o['id']) }
      ok = out['open'].length === 0
    } else if (command === 'calendar') {
      const need = uniqSorted([...MINIMUM_WINDOW, ...ids(s('derived'))])
      const seen = new Set<string>()
      for (const run of allRuns(ws)) if (run['gate_unit'] === s('gate-unit')) for (const e of run['coverage']['calendar_events']) seen.add(e)
      out = { required: need, covered: need.filter((e) => seen.has(e)), missing: need.filter((e) => !seen.has(e)) }
      ok = out['missing'].length === 0
    } else if (command === 'surface' && sub === 'check') {
      const surf = load(s('file')!)
      const problems = (surf['observables'] ?? []).map((o: Obj) => ({ id: o['id'], problem: observableIdProblem(surf['gate_unit'], String(o['id'])) }))
        .filter((p: Obj) => p.problem !== null)
      const dup = uniqSorted((surf['observables'] ?? []).map((o: Obj) => o['id']).filter((x: string, i: number, a: string[]) => a.indexOf(x) !== i))
      out = { gate_unit: surf['gate_unit'], observables: (surf['observables'] ?? []).length, problems, duplicates: dup }
      ok = problems.length === 0 && dup.length === 0
    } else {
      throw new Bad(`unknown command ${[command, sub].filter(Boolean).join(' ')}`)
    }
    console.log(pretty(out))
    return ok ? 0 : 1
  } catch (e) {
    if (e instanceof Bad || (e as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS')) {
      console.log(JSON.stringify({ error: (e as Error).message }))
      return 2
    }
    throw e
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
