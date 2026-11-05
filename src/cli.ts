/**
 * The `rig` command line.
 *
 *   rig init PATH [--name N] [--legacy DIR] [--example noop]
 *   rig run      [-C PATH] [--max-stages N]    run or resume the programme
 *   rig status   [-C PATH] [--json]
 *   rig events   [-C PATH] [--wu ID] [--tail N]
 *   rig validate [-C PATH]
 *
 * Exit codes: 0 all units merged or provisional, 1 some escalated or blocked,
 * 2 usage or workspace error, 3 halted by the programme budget.
 */

import { parseArgs } from 'node:util'

import { exitCode, fold, RunLocked, Runner, tokensByRole, tokensTotal } from './engine.ts'
import { LogCorrupt, readEvents } from './events.ts'
import { TERMINAL } from './states.ts'
import { Workspace, WorkspaceError } from './workspace.ts'

const VERSION = '0.0.1'
const USAGE = `usage: rig <init|run|status|events|validate> [options]
  rig init PATH [--name N] [--legacy DIR] [--example noop]
  rig run [-C PATH] [--max-stages N]
  rig status [-C PATH] [--json]
  rig events [-C PATH] [--wu ID] [--tail N]
  rig validate [-C PATH]`

class UsageError extends Error {}

type Out = { log: (s: string) => void; err: (s: string) => void }
const stdio: Out = { log: (s) => console.log(s), err: (s) => console.error(s) }

const wsOf = (c: string | undefined) => Workspace.find(c)
const intOf = (v: string | undefined, flag: string): number | undefined => {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${flag} needs a non-negative integer`)
  return n
}

export async function main(argv: string[], out: Out = stdio): Promise<number> {
  const [cmd, ...rest] = argv
  try {
    switch (cmd) {
      case 'init': return init(rest, out)
      case 'run': return await run(rest, out)
      case 'status': return status(rest, out)
      case 'events': return events(rest, out)
      case 'validate': return validate(rest, out)
      case '--version': out.log(`rig ${VERSION}`); return 0
      case undefined: case '-h': case '--help': out.log(USAGE); return cmd === undefined ? 2 : 0
      default: throw new UsageError(`unknown command '${cmd}'`)
    }
  } catch (e) {
    if (e instanceof UsageError) {
      out.err(`rig: ${e.message}\n${USAGE}`)
      return 2
    }
    if (e instanceof WorkspaceError || e instanceof RunLocked || e instanceof LogCorrupt
        || (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION')) {
      out.err(`rig: error: ${e.message}`)
      return 2
    }
    throw e
  }
}

const wsOption = { C: { type: 'string', short: 'C' } } as const

function init(argv: string[], out: Out): number {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { name: { type: 'string' }, legacy: { type: 'string' }, example: { type: 'string' } },
  })
  const [path] = positionals
  if (path === undefined || positionals.length > 1) throw new UsageError('init needs exactly one PATH')
  const ws = Workspace.init(path, {
    name: values.name ?? path.split('/').filter(Boolean).at(-1) ?? 'programme',
    ...(values.legacy !== undefined && { legacy: values.legacy }),
    ...(values.example !== undefined && { example: values.example }),
  })
  out.log(`initialised RIG workspace at ${ws.root}`)
  return 0
}

function validate(argv: string[], out: Out): number {
  const { values } = parseArgs({ args: argv, options: wsOption })
  const ws = wsOf(values.C)
  const prog = ws.loadProgramme()
  const units = ws.loadWorkUnits()
  out.log(`programme ${prog.name}: ${units.size} work unit(s) OK`)
  return 0
}

async function run(argv: string[], out: Out): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { ...wsOption, 'max-stages': { type: 'string' } } })
  const maxStages = intOf(values['max-stages'], '--max-stages')
  const result = await new Runner(wsOf(values.C)).run(maxStages === undefined ? {} : { maxStages })
  const s = result.summary
  out.log(`run ${result.runId} ${result.status}: ${JSON.stringify(s.byState)} tokens=${s.tokens}`)
  if (s.reason) out.log(`  halted: ${s.reason}`)
  for (const w of s.escalated) out.log(`  escalated: ${w}`)
  for (const w of s.blocked) out.log(`  blocked (a dependency escalated): ${w}`)
  return exitCode(result)
}

function status(argv: string[], out: Out): number {
  const { values } = parseArgs({ args: argv, options: { ...wsOption, json: { type: 'boolean' } } })
  const ws = wsOf(values.C)
  const units = ws.loadWorkUnits()
  const ps = fold(readEvents(ws.eventsPath))
  const rows = [...units.keys()].map((id) => {
    const u = ps.units.get(id)
    return {
      wu: id,
      state: u?.state ?? 'queued',
      attempt: u?.attempt ?? 1,
      tokens: u?.usage.tokens ?? 0,
      wallclock_s: Math.round((u?.usage.wallclockS ?? 0) * 1000) / 1000,
      in_flight: u?.inFlight?.stage ?? null,
      reason: u?.escalationReason ?? null,
    }
  })
  const terminal = rows.filter((r) => TERMINAL.has(r.state)).length
  const report = {
    units: rows, terminal, total: rows.length, tokens: tokensTotal(ps),
    tokens_by_role: tokensByRole(ps), last_run: ps.lastRun, open_runs: ps.openRuns,
  }
  if (values.json) {
    out.log(JSON.stringify(report, null, 2))
    return 0
  }
  out.log(`${'WORK UNIT'.padEnd(14)} ${'STATE'.padEnd(14)} ${'ATT'.padStart(3)} ${'TOKENS'.padStart(10)} ${'WALL s'.padStart(8)}  NOTE`)
  for (const r of rows) {
    const note = r.reason ?? (r.in_flight ? `in flight: ${r.in_flight}` : '')
    out.log(`${r.wu.padEnd(14)} ${r.state.padEnd(14)} ${String(r.attempt).padStart(3)} ${String(r.tokens).padStart(10)} ${String(r.wallclock_s).padStart(8)}  ${note}`)
  }
  out.log(`\n${terminal}/${rows.length} terminal · tokens ${report.tokens} · by role ${JSON.stringify(report.tokens_by_role)}`)
  if (ps.lastRun) {
    const hint = ps.lastRun.status === 'running' ? ' (if no runner is alive, `rig run` resumes it)' : ''
    out.log(`last run ${ps.lastRun.runId}: ${ps.lastRun.status}${hint}`)
  }
  return 0
}

function events(argv: string[], out: Out): number {
  const { values } = parseArgs({ args: argv, options: { ...wsOption, wu: { type: 'string' }, tail: { type: 'string' } } })
  let evs = readEvents(wsOf(values.C).eventsPath)
  if (values.wu !== undefined) evs = evs.filter((e) => e['wu'] === values.wu)
  const tail = intOf(values.tail, '--tail')
  if (tail !== undefined) evs = evs.slice(-tail)
  for (const e of evs) out.log(JSON.stringify(e))
  return 0
}
