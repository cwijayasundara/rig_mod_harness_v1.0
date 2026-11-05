#!/usr/bin/env node
/**
 * RIG architecture tests (docs/PROPOSAL.md Phase D). Node 24+ runs this file directly. No dependencies.
 *
 * A restructure moves code into modules without changing the observation surface. This script checks the module
 * rules of the signed decomposition against a source tree, mechanically. The judge proves behaviour; this proves shape.
 *
 *     node rig_arch.ts check --ws <workspace> --system <name> --root <source root> [--modules <MODULES.json>]
 *                            [--scope <path prefixes, comma-separated>] [--gate-units <ids, comma-separated>]
 *     node rig_arch.ts hash  --ws <workspace> --system <name> [--modules <MODULES.json>]
 *
 * `check` fails (exit 1) on any violation:
 *   unassigned     a source file whose package belongs to no module
 *   ambiguous      a package listed by two modules
 *   module         a depends_on that names no module, or a cycle in depends_on
 *   dependency     module A references module B, and B is not in A's depends_on
 *   api            a reference to a class of another module outside that module's api packages
 *   store_owner    a store with no owning module, or more than one, or a store on a surface that MODULES.json does
 *                  not name (directly or in a store's `surface_names`)
 *   store_access   a store's marker appears in a file outside its owning module
 *   signoff        the ADRs and MODULES.json are not signed by a person, or changed since they were signed
 * With --scope (a restructure unit moving one module), file violations count only for files under those prefixes;
 * module, store_owner and signoff violations always count. The rest are listed under `outside_scope`.
 * With --gate-units, only those gate units' surfaces are checked for unnamed stores (a unit restructures the code of its
 * gate units; an unknown store of another job stays that job's open item, Rule A).
 * `hash` prints the hashes a person's sign-off records (`/rig:review <system> adrs`).
 *
 * MODULES.json (analysis/<system>/decomposition/MODULES.json, the chosen partition, drafted by the architecture
 * critic and signed with its ADRs):
 *   { "language": "java", "base_package": "carddemo", "adrs": ["ADR-0001"],
 *     "modules": { "<name>": { "packages": ["carddemo.customer"], "api": ["carddemo.customer"],
 *                              "depends_on": ["shared"], "owns": ["CUSTFILE"] } },
 *     "stores":  { "CUSTFILE": { "markers": ["DD_CUSTFILE"] } } }
 * A package belongs to the module listing it or its longest listed prefix. Sign-offs are in
 * analysis/<system>/decomposition/signoffs.json, which only a person writes (the guard denies subagents):
 *   [{ "adr": "ADR-0001", "adr_sha256": "...", "modules_sha256": "...", "signed_by": "...", "signed_on": "..." }]
 *
 * Every command prints JSON and exits 0 when its check passes, 1 when it fails, 2 on bad input.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

type Obj = Record<string, any>
export type Violation = { rule: string; file?: string; line?: number; detail: string }
class Bad extends Error {}

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')
const load = (p: string): any => {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { throw new Bad(`cannot read ${p}: ${(e as Error).message}`) }
}

function walk(dir: string, ext: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (name.endsWith(ext)) out.push(p)
  }
  return out
}

/** Java source with comments blanked, keeping line numbers. With `strings`, string and char literals are blanked too. */
export function stripJava(src: string, strings: boolean): string {
  let out = ''
  for (let i = 0; i < src.length;) {
    const c = src[i]!, d = src[i + 1]
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++ } }
    else if (c === '/' && d === '*') {
      out += '  '; i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++ }
      out += '  '; i += 2
    } else if (c === '"' && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3)
      const lit = src.slice(i, end < 0 ? src.length : end + 3)
      out += strings ? lit.replace(/[^\n]/g, ' ') : lit
      i += lit.length
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      const lit = src.slice(i, j + 1)
      out += strings ? lit.replace(/[^\n]/g, ' ') : lit
      i = j + 1
    } else { out += c; i++ }
  }
  return out
}

const lineOf = (text: string, idx: number) => text.slice(0, idx).split('\n').length

/**
 * The store of a store-level observable id (after `<unit>/`), parsed as the comparator writes it, so a dotted store
 * name (`REMOTE.welcome.txt.store_write`) stays whole. An id outside that grammar names no store here; `rig_proof.ts
 * surface check` reports it.
 */
export const surfaceStore = (rest: string): string | null =>
  /^(.+)\.(store_write|cardinality|record_order|store_semantics|field:[^\s:]+)$/.exec(rest)?.[1] ?? null

export function moduleOf(pkg: string, modules: Obj): string | null {
  let best: string | null = null, len = -1
  for (const [name, m] of Object.entries<Obj>(modules)) {
    for (const p of m['packages'] ?? []) {
      if ((pkg === p || pkg.startsWith(p + '.')) && p.length > len) { best = name; len = p.length }
    }
  }
  return best
}

export function hashes(modulesPath: string, adrDir: string, adrs: string[]): Obj {
  const out: Obj = { modules_sha256: sha(readFileSync(modulesPath)), adrs: {} }
  for (const a of adrs) {
    const p = join(adrDir, `${a}.md`)
    out['adrs'][a] = existsSync(p) ? sha(readFileSync(p)) : null
  }
  return out
}

export function check(spec: Obj, files: { path: string; text: string }[], signoffs: Obj[] | null, h: Obj, surfaceStores: string[] = []): Violation[] {
  const v: Violation[] = []
  const modules: Obj = spec['modules'] ?? {}
  const base = String(spec['base_package'] ?? '')
  if (spec['language'] !== 'java') throw new Bad(`language ${JSON.stringify(spec['language'])}: only java is supported`)
  if (!base) throw new Bad('base_package is required')

  // module graph
  const seenPkg = new Map<string, string>()
  for (const [name, m] of Object.entries<Obj>(modules)) {
    for (const p of m['packages'] ?? []) {
      if (seenPkg.has(p)) v.push({ rule: 'ambiguous', detail: `package ${p} is listed by ${seenPkg.get(p)} and ${name}` })
      seenPkg.set(p, name)
    }
    for (const d of m['depends_on'] ?? []) if (!(d in modules)) v.push({ rule: 'module', detail: `${name} depends on unknown module ${d}` })
  }
  const state = new Map<string, number>()
  const visit = (n: string, path: string[]): void => {
    if (state.get(n) === 2) return
    if (state.get(n) === 1) { v.push({ rule: 'module', detail: `cycle in depends_on: ${[...path.slice(path.indexOf(n)), n].join(' -> ')}` }); return }
    state.set(n, 1)
    for (const d of modules[n]?.['depends_on'] ?? []) if (d in modules) visit(d, [...path, n])
    state.set(n, 2)
  }
  for (const n of Object.keys(modules).sort()) visit(n, [])

  // stores
  const owner: Record<string, string[]> = {}
  for (const [name, m] of Object.entries<Obj>(modules)) for (const s of m['owns'] ?? []) (owner[s] ??= []).push(name)
  for (const s of Object.keys(spec['stores'] ?? {}).sort()) {
    if ((owner[s] ?? []).length !== 1) v.push({ rule: 'store_owner', detail: `store ${s} has ${(owner[s] ?? []).length} owning modules (${(owner[s] ?? []).join(', ') || 'none'}); it needs exactly one` })
  }
  for (const s of Object.keys(owner)) if (!(s in (spec['stores'] ?? {}))) v.push({ rule: 'store_owner', detail: `store ${s} is owned but has no markers under "stores"` })
  const named = new Set(Object.entries<Obj>(spec['stores'] ?? {}).flatMap(([k, st]) => [k, ...(st['surface_names'] ?? [])]))
  for (const s of [...new Set(surfaceStores)].sort()) if (!named.has(s)) v.push({ rule: 'store_owner', detail: `store ${s} is on a surface but MODULES.json does not name it (add it, or list it in a store's surface_names)` })

  // files
  const classModule = new Map<string, string>() // fully qualified class -> module
  const parsed = files.map((f) => {
    const code = stripJava(f.text, true)
    const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(code)?.[1] ?? ''
    const mod = moduleOf(pkg, modules)
    for (const m of code.matchAll(/\b(?:class|interface|enum|record)\s+([A-Z]\w*)/g)) classModule.set(`${pkg}.${m[1]}`, mod ?? '')
    return { ...f, code, pkg, mod }
  })
  const fqn = new RegExp(`\\b(${base.replace(/\./g, '\\.')}(?:\\.[a-z_]\\w*)*)\\.([A-Z]\\w*)`, 'g')
  for (const f of parsed) {
    if (f.mod === null) { v.push({ rule: 'unassigned', file: f.path, detail: `package ${f.pkg || '(default)'} belongs to no module` }); continue }
    const deps = new Set<string>(modules[f.mod]['depends_on'] ?? [])
    const seen = new Set<string>()
    for (const m of f.code.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\.\*\s*;/gm)) {
      const pkg = m[1]!
      const target = moduleOf(pkg, modules)
      if (target && target !== f.mod) v.push({ rule: 'api', file: f.path, line: lineOf(f.code, m.index!), detail: `wildcard import of ${pkg}.* from ${f.mod}; name each class` })
    }
    for (const m of f.code.matchAll(fqn)) {
      const pkg = m[1]!, cls = `${m[1]}.${m[2]}`
      if (seen.has(cls)) continue
      seen.add(cls)
      const target = classModule.get(cls) ?? moduleOf(pkg, modules)
      if (!target || target === f.mod) continue
      const line = lineOf(f.code, m.index!)
      if (!deps.has(target)) v.push({ rule: 'dependency', file: f.path, line, detail: `${f.mod} uses ${cls} of module ${target}, which ${f.mod} does not depend on` })
      else if (!(modules[target]['api'] ?? []).includes(pkg)) v.push({ rule: 'api', file: f.path, line, detail: `${cls} is not in the api of ${target} (${(modules[target]['api'] ?? []).join(', ') || 'none'})` })
    }
    const withStrings = stripJava(f.text, false)
    for (const [s, st] of Object.entries<Obj>(spec['stores'] ?? {})) {
      if ((owner[s] ?? []).length !== 1 || owner[s]![0] === f.mod) continue
      for (const mk of st['markers'] ?? []) {
        const i = withStrings.indexOf(mk)
        if (i >= 0) v.push({ rule: 'store_access', file: f.path, line: lineOf(withStrings, i), detail: `${f.mod} touches store ${s} (marker ${JSON.stringify(mk)}), owned by ${owner[s]![0]}` })
      }
    }
  }

  // sign-off: every ADR, and this exact MODULES.json
  const adrs: string[] = spec['adrs'] ?? []
  if (adrs.length === 0) v.push({ rule: 'signoff', detail: 'MODULES.json names no ADR' })
  for (const a of adrs) {
    const so = (signoffs ?? []).find((x) => x['adr'] === a && x['signed_by'])
    if (h['adrs'][a] === null) v.push({ rule: 'signoff', detail: `${a}.md does not exist` })
    else if (!so) v.push({ rule: 'signoff', detail: `${a} is not signed by a person` })
    else if (so['adr_sha256'] !== h['adrs'][a]) v.push({ rule: 'signoff', detail: `${a}.md changed after ${so['signed_by']} signed it` })
    else if (so['modules_sha256'] !== h['modules_sha256']) v.push({ rule: 'signoff', detail: `MODULES.json changed after ${so['signed_by']} signed ${a}` })
  }
  return v
}

export function main(argv: string[]): number {
  const { values: a, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: { ws: { type: 'string' }, system: { type: 'string' }, root: { type: 'string' }, modules: { type: 'string' }, scope: { type: 'string' }, 'gate-units': { type: 'string' }, help: { type: 'boolean' } },
  })
  const [command] = positionals
  if (a.help || !command) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); return 0 }
  try {
    if (!a.system) throw new Bad('--system is required')
    const ws = resolve(a.ws ?? '.')
    const dec = join(ws, 'analysis', a.system, 'decomposition')
    const modulesPath = resolve(ws, a.modules ?? join(dec, 'MODULES.json'))
    const spec = load(modulesPath)
    const h = hashes(modulesPath, join(ws, 'analysis', a.system), spec['adrs'] ?? [])
    let out: Obj, ok = true
    if (command === 'hash') {
      out = h
    } else if (command === 'check') {
      if (!a.root) throw new Bad('--root is required')
      const root = resolve(ws, a.root)
      if (!existsSync(root)) throw new Bad(`no source root ${root}`)
      const files = walk(root, '.java').map((p) => ({ path: relative(ws, p), text: readFileSync(p, 'utf8') }))
      if (files.length === 0) throw new Bad(`no .java files under ${root}`)
      const signoffsPath = join(dec, 'signoffs.json')
      const surfDir = join(ws, 'analysis', a.system, 'surfaces')
      const surfaceStores = existsSync(surfDir) ? readdirSync(surfDir).filter((x) => x.endsWith('.json')).flatMap((x) => {
        const sf = load(join(surfDir, x))
        const want = (a['gate-units'] ?? '').split(',').map((g) => g.trim()).filter(Boolean)
        if (want.length > 0 && !want.includes(String(sf['gate_unit']))) return []
        const u = String(sf['gate_unit'] ?? '').replace(/^[^:]*:/, '')
        return (sf['observables'] ?? []).map((o: Obj) => String(o['id'])).filter((id: string) => id.startsWith(u + '/'))
          .map((id: string) => surfaceStore(id.slice(u.length + 1))).filter((x: string | null): x is string => x !== null)
      }) : []
      const v = check(spec, files, existsSync(signoffsPath) ? load(signoffsPath) : null, h, surfaceStores)
      const per: Obj = {}
      for (const f of files) {
        const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(stripJava(f.text, true))?.[1] ?? ''
        const m = moduleOf(pkg, spec['modules'] ?? {}) ?? '(none)'
        per[m] = (per[m] ?? 0) + 1
      }
      const scope = (a.scope ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      const inScope = (x: Violation) => !x.file || scope.length === 0 || scope.some((p) => x.file!.startsWith(p))
      const counted = v.filter(inScope)
      out = { pass: counted.length === 0, files: files.length, files_per_module: per, violations: counted, outside_scope: v.filter((x) => !inScope(x)) }
      ok = counted.length === 0
    } else {
      throw new Bad(`unknown command ${command}`)
    }
    console.log(JSON.stringify(out, null, 2))
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
