/**
 * Work-unit state machine (PROPOSAL.md §5.2).
 *
 *     queued → context_build → recipes → implement → self_check
 *            → review_a → review_b → review_c → fix → judge
 *            → merged | provisional | retry | escalate
 *
 * `retry` (and a failed self-check) goes back to `context_build` and starts a
 * new attempt. Any non-terminal state may move to `escalated` when a budget is
 * exceeded or the adapter fails.
 */

export const STAGES = [
  'context_build',
  'recipes',
  'implement',
  'self_check',
  'review_a',
  'review_b',
  'review_c',
  'fix',
  'judge',
] as const

export type Stage = (typeof STAGES)[number]
export type Terminal = 'merged' | 'provisional' | 'escalated'
export type State = 'queued' | Stage | Terminal

export const TERMINAL: ReadonlySet<State> = new Set<State>(['merged', 'provisional', 'escalated'])
/** Terminal states that satisfy a dependent unit's `depends_on`. */
export const SATISFIES_DEPENDENCY: ReadonlySet<State> = new Set<State>(['merged', 'provisional'])

/** Who performs each stage. `harness` stages are deterministic tools, not models. */
export const ROLE: Readonly<Record<Stage, string>> = {
  context_build: 'harness',
  recipes: 'harness',
  implement: 'worker',
  self_check: 'harness',
  review_a: 'reviewer-a',
  review_b: 'reviewer-b',
  review_c: 'reviewer-c',
  fix: 'fixer',
  judge: 'judge',
}

/** Legal outcomes of each stage, and the state each one leads to. */
export const OUTCOMES: Readonly<Record<Stage, Readonly<Record<string, State>>>> = {
  context_build: { ok: 'recipes' },
  recipes: { ok: 'implement' },
  implement: { ok: 'self_check' },
  self_check: { pass: 'review_a', fail: 'context_build' },
  review_a: { ok: 'review_b' },
  review_b: { ok: 'review_c' },
  review_c: { ok: 'fix' },
  fix: { ok: 'judge' },
  judge: { merged: 'merged', provisional: 'provisional', retry: 'context_build', escalate: 'escalated' },
}

/** The outcome each stage produces when nothing goes wrong. */
export const DEFAULT_OUTCOME: Readonly<Record<Stage, string>> = {
  context_build: 'ok',
  recipes: 'ok',
  implement: 'ok',
  self_check: 'pass',
  review_a: 'ok',
  review_b: 'ok',
  review_c: 'ok',
  fix: 'ok',
  judge: 'merged',
}

export class IllegalTransition extends Error {
  override name = 'IllegalTransition'
}

export const isStage = (s: string): s is Stage => (STAGES as readonly string[]).includes(s)

export function nextState(stage: Stage, outcome: string): State {
  const to = Object.hasOwn(OUTCOMES[stage], outcome) ? OUTCOMES[stage][outcome] : undefined
  if (to === undefined) {
    const legal = Object.keys(OUTCOMES[stage]).sort().join(', ')
    throw new IllegalTransition(`stage ${stage} cannot produce outcome '${outcome}'; legal: ${legal}`)
  }
  return to
}

/** Outcomes that start a new attempt. */
export const isRetry = (stage: Stage, outcome: string): boolean =>
  (stage === 'self_check' && outcome === 'fail') || (stage === 'judge' && outcome === 'retry')
