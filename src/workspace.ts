/** Programme workspace layout (PROPOSAL.md §10), and loading of its inputs. */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { parseBudget, parseTokens, type Budget } from './budget.ts'

export const STEP_TYPES = ['uplift', 'translate', 'restructure', 'data', 'cutover', 'reimagine', 'noop'] as const

export const LAYOUT_DIRS = [
  'legacy',
  'analysis/surfaces',
  'analysis/scheduler',
  'analysis/jcl',
  'analysis/rules',
  'analysis/decomposition',
  'oracles/cases',
  'oracles/sets',
  'oracles/sealed',
  'oracles/generators',
  'oracles/canaries',
  'oracles/normalizers',
  'oracles/deltas',
  'oracles/comparators',
  'obligations',
  'work',
  'modernized',
  'evidence',
  '.rig',
] as const

export class WorkspaceError extends Error {
  override name = 'WorkspaceError'
}

export type WorkUnit = {
  readonly id: string
  readonly type: (typeof STEP_TYPES)[number]
  readonly budget: Budget
  readonly dependsOn: readonly string[]
  readonly raw: Readonly<Record<string, unknown>>
}

export type Programme = {
  readonly name: string
  readonly agent: Record<string, unknown>
  readonly tokenBudget: number | null
}

const isMapping = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseWorkUnit(raw: unknown, source: string): WorkUnit {
  if (!isMapping(raw)) throw new WorkspaceError(`${source}: must be a mapping`)
  for (const key of ['id', 'type']) {
    if (!(key in raw)) throw new WorkspaceError(`${source}: missing required key '${key}'`)
  }
  const type = raw['type']
  if (!(STEP_TYPES as readonly unknown[]).includes(type)) {
    throw new WorkspaceError(`${source}: unknown type ${JSON.stringify(type)}; known: ${STEP_TYPES.join(', ')}`)
  }
  let budget: Budget
  try {
    budget = parseBudget(raw['budget'])
  } catch (e) {
    throw new WorkspaceError(`${source}: ${(e as Error).message}`)
  }
  const deps = raw['depends_on'] ?? []
  if (!Array.isArray(deps) || !deps.every((d) => typeof d === 'string')) {
    throw new WorkspaceError(`${source}: depends_on must be a list of unit ids`)
  }
  return { id: String(raw['id']), type: type as WorkUnit['type'], budget, dependsOn: deps, raw }
}

export class Workspace {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  get rigDir() { return join(this.root, '.rig') }
  get eventsPath() { return join(this.rigDir, 'events.jsonl') }
  get lockPath() { return join(this.rigDir, 'run.lock') }
  get programmePath() { return join(this.root, 'PROGRAMME.yaml') }
  get workDir() { return join(this.root, 'work') }

  /** The workspace at or above `start`. */
  static find(start: string = process.cwd()): Workspace {
    let dir = resolve(start)
    for (;;) {
      if (isFile(join(dir, 'PROGRAMME.yaml')) && isDir(join(dir, '.rig'))) return new Workspace(dir)
      const parent = dirname(dir)
      if (parent === dir) throw new WorkspaceError(`no RIG workspace at or above ${resolve(start)} (run \`rig init\`)`)
      dir = parent
    }
  }

  static init(root: string, opts: { name: string; legacy?: string; example?: string }): Workspace {
    const ws = new Workspace(root)
    if (existsSync(ws.programmePath)) throw new WorkspaceError(`${ws.root} is already a RIG workspace`)
    if (opts.example !== undefined && opts.example !== 'noop') throw new WorkspaceError(`unknown example '${opts.example}'`)
    const legacy = opts.legacy === undefined ? undefined : resolve(opts.legacy)
    if (legacy !== undefined && !isDir(legacy)) throw new WorkspaceError(`legacy path ${legacy} is not a directory`)

    for (const d of LAYOUT_DIRS) mkdirSync(join(ws.root, d), { recursive: true })
    if (legacy !== undefined) symlinkSync(legacy, join(ws.root, 'legacy', basename(legacy)), 'dir')

    writeYaml(ws.programmePath, {
      name: opts.name,
      agent: { adapter: 'noop', options: { delay_s: 0, tokens_per_call: 0 } },
      budget: { tokens: null },
    })
    const docs: Record<string, string> = {
      'INTENT.md': `# Intent: ${opts.name}\n\nTo be written by the intake role.\n`,
      'PREFLIGHT.md': '# Preflight\n\nNot run. Capability smoke tests arrive in M1.\n',
      'VERIFICATION.md': '# Verification\n\nNo verdicts yet.\n',
      'CUTOVER.md': '# Cutover\n\nNo entry points cut over.\n',
    }
    for (const [file, text] of Object.entries(docs)) writeFileSync(join(ws.root, file), text)
    if (opts.example === 'noop') for (const wu of NOOP_EXAMPLE) writeYaml(join(ws.workDir, `${wu['id']}.yaml`), wu)
    return ws
  }

  loadProgramme(): Programme {
    const raw = readYaml(this.programmePath)
    if (!isMapping(raw) || typeof raw['name'] !== 'string') {
      throw new WorkspaceError(`${this.programmePath}: must be a mapping with a name`)
    }
    const budget = isMapping(raw['budget']) ? raw['budget'] : {}
    let tokenBudget: number | null
    try {
      tokenBudget = parseTokens(budget['tokens'])
    } catch (e) {
      throw new WorkspaceError(`${this.programmePath}: ${(e as Error).message}`)
    }
    const agent = isMapping(raw['agent']) ? raw['agent'] : { adapter: 'noop' }
    return { name: raw['name'], agent, tokenBudget }
  }

  /** Every `work/WU-*.yaml`, keyed by id, with dependencies checked. */
  loadWorkUnits(): Map<string, WorkUnit> {
    const units = new Map<string, WorkUnit>()
    const files = existsSync(this.workDir) ? readdirSync(this.workDir).filter((f) => /^WU-.*\.yaml$/.test(f)).sort() : []
    for (const file of files) {
      const path = join(this.workDir, file)
      const wu = parseWorkUnit(readYaml(path), relative(this.root, path))
      if (units.has(wu.id)) throw new WorkspaceError(`${path}: duplicate work unit id ${wu.id}`)
      units.set(wu.id, wu)
    }
    for (const wu of units.values()) {
      for (const d of wu.dependsOn) if (!units.has(d)) throw new WorkspaceError(`${wu.id} depends on unknown unit ${d}`)
    }
    topoOrder(units)
    return units
  }
}

/** A deterministic topological order (Kahn's algorithm, ties broken by id). */
export function topoOrder(units: ReadonlyMap<string, WorkUnit>): string[] {
  const indeg = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const [id, wu] of units) {
    indeg.set(id, wu.dependsOn.length)
    dependents.set(id, dependents.get(id) ?? [])
    for (const d of wu.dependsOn) dependents.set(d, [...(dependents.get(d) ?? []), id])
  }
  const ready = [...indeg].filter(([, n]) => n === 0).map(([id]) => id).sort()
  const order: string[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    order.push(id)
    for (const v of dependents.get(id) ?? []) {
      const n = indeg.get(v)! - 1
      indeg.set(v, n)
      if (n === 0) {
        ready.push(v)
        ready.sort()
      }
    }
  }
  if (order.length !== units.size) {
    const cyclic = [...units.keys()].filter((id) => !order.includes(id)).sort()
    throw new WorkspaceError(`dependency cycle among ${cyclic.join(', ')}`)
  }
  return order
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile()
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory()

function readYaml(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new WorkspaceError(`missing ${path}`)
  }
  try {
    return parseYaml(text)
  } catch (e) {
    throw new WorkspaceError(`${path}: ${(e as Error).message}`)
  }
}

export function writeYaml(path: string, data: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, stringifyYaml(data))
  renameSync(tmp, path)
}

const NOOP_EXAMPLE: Record<string, unknown>[] = [1, 2, 3].map((n) => ({
  id: `WU-N-000${n}`,
  type: 'noop',
  source_scope: [`legacy/example/${'ABC'[n - 1]}.cbl`],
  target_scope: [`modernized/example/${'abc'[n - 1]}/**`],
  gate_unit: `job:EXJOB${n}`,
  ...(n > 1 ? { depends_on: ['WU-N-0001'] } : {}),
  budget: { tokens: '1M', wallclock: '10m', attempts: 3 },
}))
