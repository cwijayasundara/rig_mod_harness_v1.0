/**
 * Budgets (PROPOSAL.md §5.1, §12). A budget that is exceeded escalates the
 * unit, so the harness never keeps spending.
 */

export type Budget = {
  readonly tokens: number | null
  readonly wallclockS: number | null
  readonly attempts: number | null
}

export type Usage = { tokens: number; wallclockS: number; attempts: number }

export const newUsage = (): Usage => ({ tokens: 0, wallclockS: 0, attempts: 1 })

const TOKEN_SUFFIX: Record<string, number> = { '': 1, k: 1e3, m: 1e6, b: 1e9 }
const TIME_SUFFIX: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600 }

function parseScaled(v: unknown, what: string, suffixes: Record<string, number>): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
  if (typeof v === 'string') {
    const m = /^\s*(\d*\.?\d+)\s*([a-z]?)\s*$/i.exec(v)
    const scale = m ? suffixes[m[2]!.toLowerCase()] : undefined
    if (m && scale !== undefined) return Number(m[1]) * scale
  }
  throw new Error(`bad ${what} budget: ${JSON.stringify(v)}`)
}

/** '2.5M' → 2_500_000, '800k' → 800_000, 1200 → 1200. */
export const parseTokens = (v: unknown): number | null => {
  const n = parseScaled(v, 'token', TOKEN_SUFFIX)
  return n === null ? null : Math.floor(n)
}

/** '45m' → 2700, '90s' → 90, '1h' → 3600, 30 → 30 (seconds). */
export const parseDuration = (v: unknown): number | null => parseScaled(v, 'wallclock', TIME_SUFFIX)

export function parseBudget(raw: unknown): Budget {
  if (raw === null || raw === undefined) return { tokens: null, wallclockS: null, attempts: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('budget must be a mapping')
  const r = raw as Record<string, unknown>
  const unknown = Object.keys(r).filter((k) => !['tokens', 'wallclock', 'attempts'].includes(k))
  if (unknown.length > 0) throw new Error(`unknown budget keys: ${unknown.sort().join(', ')}`)
  const attempts = r['attempts']
  if (attempts !== undefined && attempts !== null && !(Number.isInteger(attempts) && (attempts as number) >= 1)) {
    throw new Error(`bad attempts budget: ${JSON.stringify(attempts)}`)
  }
  return {
    tokens: parseTokens(r['tokens']),
    wallclockS: parseDuration(r['wallclock']),
    attempts: (attempts as number | undefined) ?? null,
  }
}

/**
 * The reason `usage` has used up `budget`, or null. The engine checks this
 * before each stage starts, so a unit at its limit starts no further stage.
 */
export function exceeded(budget: Budget, usage: Usage): string | null {
  if (budget.attempts !== null && usage.attempts > budget.attempts) {
    return `attempts ${usage.attempts} > ${budget.attempts}`
  }
  if (budget.tokens !== null && usage.tokens >= budget.tokens) {
    return `tokens ${usage.tokens} >= ${budget.tokens}`
  }
  if (budget.wallclockS !== null && usage.wallclockS >= budget.wallclockS) {
    return `wallclock ${usage.wallclockS.toFixed(1)}s >= ${budget.wallclockS.toFixed(1)}s`
  }
  return null
}
