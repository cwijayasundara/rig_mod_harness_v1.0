/**
 * The programme runner.
 *
 * State lives only in the event log. `fold` rebuilds it from events, and
 * `Runner.run` replays the log, then moves units forward one stage at a time.
 * Each stage ends with a single `stage_completed` event that names the next
 * state, so a transition is one fsynced line. A kill at any point loses at most
 * the stage in flight, which runs again on resume.
 *
 * Event types:
 *   run_started       {run_id, pid}
 *   run_resumed       {run_id, interrupted_run_id}
 *   run_finished      {run_id, status, summary}
 *   run_halted        {run_id, reason}
 *   wu_registered     {wu, contract_hash, depends_on, budget}
 *   wu_started        {wu}                  queued → context_build
 *   stage_started     {wu, stage, attempt}
 *   stage_completed   {wu, stage, attempt, role, outcome, tokens, elapsed_s, to}
 *   stage_interrupted {wu, stage, attempt}  a run died mid-stage
 *   escalated         {wu, from, reason}
 *   log_repaired      {dropped_bytes}
 */

import { createHash, randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'

import { AgentError, makeAdapter, type AgentAdapter } from './agents.ts'
import { exceeded, newUsage, type Usage } from './budget.ts'
import { EventLog, type Event } from './events.ts'
import { IllegalTransition, isRetry, isStage, nextState, ROLE, SATISFIES_DEPENDENCY, TERMINAL, type Stage, type State } from './states.ts'
import { topoOrder, WorkspaceError, type Programme, type Workspace, type WorkUnit } from './workspace.ts'

export class RunLocked extends Error {
  override name = 'RunLocked'
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export type UnitState = {
  wu: string
  state: State
  attempt: number
  usage: Usage
  tokensByRole: Record<string, number>
  inFlight: { stage: Stage; attempt: number } | null
  contractHash: string | null
  escalationReason: string | null
}

export type ProgrammeState = {
  units: Map<string, UnitState>
  /** Runs that started and never finished, halted or were resumed. */
  openRuns: string[]
  lastRun: { runId: string; status: 'running' | 'finished' | 'paused' | 'halted'; reason?: string } | null
}

const newUnit = (wu: string): UnitState => ({
  wu, state: 'queued', attempt: 1, usage: newUsage(), tokensByRole: {}, inFlight: null, contractHash: null, escalationReason: null,
})

export function fold(events: readonly Event[]): ProgrammeState {
  const ps: ProgrammeState = { units: new Map(), openRuns: [], lastRun: null }
  const unit = (ev: Event): UnitState => {
    const id = String(ev['wu'])
    let u = ps.units.get(id)
    if (u === undefined) ps.units.set(id, (u = newUnit(id)))
    return u
  }
  const closeRun = (id: unknown) => { ps.openRuns = ps.openRuns.filter((r) => r !== id) }

  for (const ev of events) {
    switch (ev.type) {
      case 'run_started':
        ps.openRuns.push(String(ev['run_id']))
        ps.lastRun = { runId: String(ev['run_id']), status: 'running' }
        break
      case 'run_finished':
        closeRun(ev['run_id'])
        ps.lastRun = { runId: String(ev['run_id']), status: ev['status'] === 'paused' ? 'paused' : 'finished' }
        break
      case 'run_halted':
        closeRun(ev['run_id'])
        ps.lastRun = { runId: String(ev['run_id']), status: 'halted', reason: String(ev['reason']) }
        break
      case 'run_resumed':
        closeRun(ev['interrupted_run_id'])
        break
      case 'wu_registered':
        unit(ev).contractHash = String(ev['contract_hash'])
        break
      case 'wu_started':
        unit(ev).state = 'context_build'
        break
      case 'stage_started':
        unit(ev).inFlight = { stage: ev['stage'] as Stage, attempt: Number(ev['attempt']) }
        break
      case 'stage_interrupted':
        unit(ev).inFlight = null
        break
      case 'stage_completed': {
        const u = unit(ev)
        const tokens = Number(ev['tokens'])
        const role = String(ev['role'])
        u.inFlight = null
        u.usage.tokens += tokens
        u.usage.wallclockS += Number(ev['elapsed_s'])
        u.tokensByRole[role] = (u.tokensByRole[role] ?? 0) + tokens
        u.state = ev['to'] as State
        if (isRetry(ev['stage'] as Stage, String(ev['outcome']))) u.usage.attempts = ++u.attempt
        break
      }
      case 'escalated': {
        const u = unit(ev)
        u.inFlight = null
        u.state = 'escalated'
        u.escalationReason = String(ev['reason'])
        break
      }
    }
  }
  return ps
}

export const tokensTotal = (ps: ProgrammeState): number =>
  [...ps.units.values()].reduce((n, u) => n + u.usage.tokens, 0)

export function tokensByRole(ps: ProgrammeState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const u of ps.units.values()) for (const [r, n] of Object.entries(u.tokensByRole)) out[r] = (out[r] ?? 0) + n
  return out
}

/** A stable hash of a work-unit contract (key order does not matter). */
export function contractHash(raw: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : v
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canon(raw))).digest('hex')
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * One runner per workspace. The lock file holds the owner's pid. A lock whose
 * pid is dead (the runner was killed) is stale and is taken over.
 */
export function acquireLock(ws: Workspace): () => void {
  mkdirSync(ws.rigDir, { recursive: true })
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(ws.lockPath, 'wx')
      writeSync(fd, `${process.pid}\n`)
      closeSync(fd)
      return () => { try { unlinkSync(ws.lockPath) } catch { /* already gone */ } }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const pid = Number.parseInt(readFileSync(ws.lockPath, 'utf8'), 10)
      if (Number.isInteger(pid) && pid !== process.pid && isAlive(pid)) {
        throw new RunLocked(`another \`rig run\` (pid ${pid}) holds ${ws.lockPath}`)
      }
      if (pid === process.pid) throw new RunLocked(`this process already holds ${ws.lockPath}`)
      unlinkSync(ws.lockPath) // stale: its owner is dead
    }
  }
  throw new RunLocked(`could not acquire ${ws.lockPath}`)
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type Summary = {
  units: number
  byState: Record<string, number>
  escalated: string[]
  blocked: string[]
  tokens: number
  tokensByRole: Record<string, number>
  reason?: string
}

export type RunResult = { runId: string; status: 'finished' | 'paused' | 'halted'; summary: Summary }

export const exitCode = (r: RunResult): number =>
  r.status === 'halted' ? 3 : r.summary.escalated.length > 0 || r.summary.blocked.length > 0 ? 1 : 0

export class Runner {
  readonly ws: Workspace
  readonly programme: Programme
  readonly units: Map<string, WorkUnit>
  readonly order: string[]
  readonly adapter: AgentAdapter

  constructor(ws: Workspace, adapter?: AgentAdapter) {
    this.ws = ws
    this.programme = ws.loadProgramme()
    this.units = ws.loadWorkUnits()
    this.order = topoOrder(this.units)
    this.adapter = adapter ?? makeAdapter(this.programme.agent)
  }

  async run(opts: { maxStages?: number } = {}): Promise<RunResult> {
    const release = acquireLock(this.ws)
    const log = new EventLog(this.ws.eventsPath).open()
    try {
      const runId = randomUUID().replaceAll('-', '').slice(0, 12)
      let ps = fold(log.events)
      this.#checkContracts(ps)

      for (const dead of ps.openRuns) log.append('run_resumed', { run_id: runId, interrupted_run_id: dead })
      for (const u of ps.units.values()) {
        if (u.inFlight) log.append('stage_interrupted', { wu: u.wu, stage: u.inFlight.stage, attempt: u.inFlight.attempt })
      }
      this.#register(log, ps)
      log.append('run_started', { run_id: runId, pid: process.pid })
      ps = fold(log.events)

      for (let stagesRun = 0; ; stagesRun++) {
        if (opts.maxStages !== undefined && stagesRun >= opts.maxStages) return this.#finish(log, runId, 'paused', ps)
        const wu = this.#nextRunnable(ps)
        if (wu === null) return this.#finish(log, runId, 'finished', ps)
        const limit = this.programme.tokenBudget
        if (limit !== null && tokensTotal(ps) >= limit) {
          const reason = `programme tokens ${tokensTotal(ps)} >= ${limit}`
          log.append('run_halted', { run_id: runId, reason })
          return { runId, status: 'halted', summary: { ...this.#summary(ps), reason } }
        }
        await this.#step(log, wu)
        ps = fold(log.events)
      }
    } finally {
      log.close()
      release()
    }
  }

  /** A unit's contract may change only while it is still queued. */
  #checkContracts(ps: ProgrammeState): void {
    for (const id of this.order) {
      const u = ps.units.get(id)
      if (u && u.state !== 'queued' && u.contractHash !== contractHash(this.units.get(id)!.raw)) {
        throw new WorkspaceError(`${id}: contract changed after the unit started (${u.state}); create a new work unit instead`)
      }
    }
  }

  #register(log: EventLog, ps: ProgrammeState): void {
    for (const id of this.order) {
      const wu = this.units.get(id)!
      const hash = contractHash(wu.raw)
      if (ps.units.get(id)?.contractHash === hash) continue
      log.append('wu_registered', { wu: id, contract_hash: hash, depends_on: wu.dependsOn, budget: wu.budget })
    }
  }

  #nextRunnable(ps: ProgrammeState): string | null {
    for (const id of this.order) {
      const u = ps.units.get(id)!
      if (TERMINAL.has(u.state)) continue
      if (this.units.get(id)!.dependsOn.every((d) => SATISFIES_DEPENDENCY.has(ps.units.get(d)!.state))) return id
    }
    return null
  }

  async #step(log: EventLog, id: string): Promise<void> {
    const wu = this.units.get(id)!
    if (fold(log.events).units.get(id)!.state === 'queued') log.append('wu_started', { wu: id })
    const u = fold(log.events).units.get(id)!

    const over = exceeded(wu.budget, u.usage)
    if (over !== null) {
      log.append('escalated', { wu: id, from: u.state, reason: `budget: ${over}` })
      return
    }
    const stage = u.state
    if (!isStage(stage)) throw new Error(`internal: ${id} is runnable in non-stage state ${stage}`)
    const role = ROLE[stage]
    log.append('stage_started', { wu: id, stage, attempt: u.attempt })
    const t0 = performance.now()
    let outcome: string, tokens: number, to: State
    try {
      const result = await this.adapter.runStage({
        wu: id, stage, role, attempt: u.attempt, workUnit: wu.raw, workspace: this.ws.root,
      })
      outcome = result.outcome
      tokens = Math.max(0, Math.floor(result.tokens))
      to = nextState(stage, outcome)
    } catch (e) {
      if (!(e instanceof AgentError || e instanceof IllegalTransition)) throw e
      log.append('escalated', { wu: id, from: stage, reason: `${e.name}: ${e.message}` })
      return
    }
    const elapsed = Math.round(performance.now() - t0) / 1000
    log.append('stage_completed', { wu: id, stage, attempt: u.attempt, role, outcome, tokens, elapsed_s: elapsed, to })
  }

  #summary(ps: ProgrammeState): Summary {
    const byState: Record<string, number> = {}
    for (const id of this.order) {
      const s = ps.units.get(id)!.state
      byState[s] = (byState[s] ?? 0) + 1
    }
    // A unit is blocked when some transitive dependency escalated.
    const doomed = (id: string): boolean =>
      ps.units.get(id)!.state === 'escalated' || this.units.get(id)!.dependsOn.some(doomed)
    return {
      units: this.order.length,
      byState,
      escalated: this.order.filter((id) => ps.units.get(id)!.state === 'escalated'),
      blocked: this.order.filter((id) => !TERMINAL.has(ps.units.get(id)!.state) && doomed(id)),
      tokens: tokensTotal(ps),
      tokensByRole: tokensByRole(ps),
    }
  }

  #finish(log: EventLog, runId: string, status: 'finished' | 'paused', ps: ProgrammeState): RunResult {
    const summary = this.#summary(ps)
    log.append('run_finished', { run_id: runId, status, summary })
    return { runId, status, summary }
  }
}
