/**
 * Agent adapter (PROPOSAL.md §9).
 *
 * Every stage of the unit loop goes through an adapter. Agent stages call a
 * model for a role, and `harness` stages run deterministic tools. M0 ships two
 * adapters with no side effects:
 *
 * - `noop`: every stage succeeds, and the judge returns `merged`.
 * - `scripted`: like noop, but outcomes can be forced per unit, stage and
 *   attempt. Tests use it to exercise retries, escalation and budgets.
 *
 * Adapters must be idempotent per (unit, stage, attempt). After a kill, the
 * interrupted stage runs again from the start.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import { DEFAULT_OUTCOME, type Stage } from './states.ts'

export type StageRequest = {
  readonly wu: string
  readonly stage: Stage
  readonly role: string
  readonly attempt: number
  readonly workUnit: Readonly<Record<string, unknown>>
  readonly workspace: string
}

export type StageResult = {
  readonly outcome: string
  readonly tokens: number
  readonly notes?: string
}

export interface AgentAdapter {
  readonly name: string
  runStage(req: StageRequest): Promise<StageResult>
}

/** The adapter could not complete the stage. The unit escalates. */
export class AgentError extends Error {
  override name = 'AgentError'
}

type NoopOptions = { delay_s?: number; tokens_per_call?: number }

export class NoopAdapter implements AgentAdapter {
  readonly name: string = 'noop'
  readonly delayMs: number
  readonly tokensPerCall: number

  constructor(opts: NoopOptions = {}) {
    this.delayMs = Math.max(0, Number(opts.delay_s ?? 0) * 1000)
    this.tokensPerCall = Math.max(0, Math.floor(Number(opts.tokens_per_call ?? 0)))
  }

  async runStage(req: StageRequest): Promise<StageResult> {
    if (this.delayMs > 0) await sleep(this.delayMs)
    return { outcome: DEFAULT_OUTCOME[req.stage], tokens: req.role === 'harness' ? 0 : this.tokensPerCall }
  }
}

/**
 * Noop with forced outcomes. `script` maps `WU-ID:stage:attempt` (attempt may
 * be `*`) to an outcome, or to `error` to throw an AgentError.
 */
export class ScriptedAdapter extends NoopAdapter {
  override readonly name = 'scripted'
  readonly script: Readonly<Record<string, string>>

  constructor(opts: NoopOptions & { script?: Record<string, string> } = {}) {
    super(opts)
    this.script = { ...opts.script }
  }

  override async runStage(req: StageRequest): Promise<StageResult> {
    const base = await super.runStage(req)
    for (const key of [`${req.wu}:${req.stage}:${req.attempt}`, `${req.wu}:${req.stage}:*`]) {
      const forced = this.script[key]
      if (forced === undefined) continue
      if (forced === 'error') throw new AgentError(`scripted error at ${key}`)
      return { outcome: forced, tokens: base.tokens, notes: `scripted ${key}` }
    }
    return base
  }
}

const REGISTRY: Record<string, new (opts: Record<string, unknown>) => AgentAdapter> = {
  noop: NoopAdapter,
  scripted: ScriptedAdapter,
}

export function makeAdapter(config: Record<string, unknown> | undefined): AgentAdapter {
  const { adapter = 'noop', options = {}, ...rest } = config ?? {}
  if (Object.keys(rest).length > 0) throw new Error(`unknown agent config keys: ${Object.keys(rest).sort().join(', ')}`)
  const Ctor = typeof adapter === 'string' && Object.hasOwn(REGISTRY, adapter) ? REGISTRY[adapter] : undefined
  if (Ctor === undefined) {
    throw new Error(`unknown agent adapter ${JSON.stringify(adapter)}; known: ${Object.keys(REGISTRY).sort().join(', ')}`)
  }
  return new Ctor((options ?? {}) as Record<string, unknown>)
}
