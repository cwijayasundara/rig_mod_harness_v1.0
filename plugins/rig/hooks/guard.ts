#!/usr/bin/env node
/**
 * RIG integrity guard, a PreToolUse hook. It reads the hook input on stdin and denies tool calls that would let the
 * code under test see or shape its own evidence:
 *
 * 1. Nothing but rig_proof.ts writes `evidence/`, `oracles/<system>/cases/` or `oracles/<system>/sets/`.
 * 2. A subagent never writes `obligations/`, `oracles/<system>/caps/`, or `analysis/<system>/attestations.yaml`.
 *    Accepting, signing and attesting are a person's decisions, recorded by the main session in /rig:review.
 * 3. `rig:worker` and `rig:fixer` never read `oracles/`, `evidence/`, `obligations/`, or the judge's and reviewers'
 *    folders under `work/`. They learn about failures only through the counts per class the loop hands them.
 * 4. `rig:reviewer-a` reads only its packet `work/<system>/<WU>/review-a<n>/` (the diff), and `rig:reviewer-b` reads
 *    only `work/<system>/<WU>/review-b<n>/` and the legacy tree. `<n>` is empty for attempt 1 and the attempt number
 *    after that (`review-a2/`). Either may also read Claude Code's own saved tool output (`~/.claude/projects/…/
 *    tool-results/`), which is where a long result of its own tool call is put.
 *
 * The guard is a second line of defence: the commands already say all this. It matches paths in file tools exactly
 * and in Bash commands by pattern, so a determined script could still get round it. The hard boundary is the
 * operating system (a sandbox, or separate checkouts).
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'

type Input = { tool_name?: string; tool_input?: Record<string, unknown>; agent_type?: string; cwd?: string }

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])

const SCRIPT_ONLY = [/^evidence\//, /^oracles\/[^/]+\/cases\//, /^oracles\/[^/]+\/sets\//]
const PERSON_ONLY = [/^obligations\//, /^oracles\/[^/]+\/caps\//, /^analysis\/[^/]+\/attestations\.yaml$/]
const HIDDEN_FROM_WORKERS = [/^oracles(\/|$)/, /^evidence(\/|$)/, /^obligations(\/|$)/, /^work\/[^/]+\/([^/]+\/)?(judge|review-[abc]\d*)(\/|$)/]
/** Claude Code saves a long tool result here and the agent reads it back. It is outside the workspace. */
const TOOL_RESULTS = /\/\.claude\/projects\/[^/]+\/[^/]+\/(subagents\/[^/]+\/)?tool-results\/[^/]+$/

const role = (agentType?: string) => (agentType ?? '').replace(/^rig:/, '')

/** Paths a tool call touches, relative to the workspace. `null` for paths outside it. */
function pathsOf(inp: Input, root: string): string[] {
  const t = inp.tool_input ?? {}
  const raw = [t['file_path'], t['notebook_path'], t['path']].filter((x): x is string => typeof x === 'string' && x !== '')
  // A Glob pattern is relative to its path (or the working directory): check the joined form, not the bare pattern.
  if (inp.tool_name === 'Glob' && typeof t['pattern'] === 'string') {
    const pat = String(t['pattern'])
    const base = typeof t['path'] === 'string' && t['path'] !== '' ? String(t['path']) : ''
    const joined = isAbsolute(pat) ? pat : base ? join(base, pat) : pat
    if (base) raw.splice(raw.indexOf(base), 1)
    raw.push(joined.replace(/\/\*\*?(\/.*)?$|\/[^/]*[*?[][^/]*(\/.*)?$/, '') || joined)
  }
  return raw.map((p) => rel(isAbsolute(p) ? p : join(inp.cwd ?? root, p), root)).filter((p): p is string => p !== null)
}

function rel(abs: string, root: string): string | null {
  const r = relative(root, normalize(abs))
  if (r.startsWith('..') || isAbsolute(r)) return null
  return r.split(sep).join('/')
}

/** Workspace-relative path fragments that a shell command mentions. */
function bashMentions(cmd: string): string[] {
  return [...cmd.matchAll(/(?:^|[\s'"=(<>|;&])(?:\.\/)?((?:evidence|oracles|obligations|work|analysis)\/[^\s'";|&<>)]*)/g)].map((m) => m[1]!)
}

const PATHCH = `[^\\s'";|&<>)]`
const strip = (p: string) => p.replace(/^\.\//, '')

/**
 * Workspace paths a shell command writes: redirect targets, tee files, the destination of cp/mv/ln, the arguments of
 * rm/touch/truncate/mkdir and in-place sed/perl, and paths given to writeFileSync/appendFileSync/open(.., 'w'|'a')
 * inside inline scripts. A path that is only read is not listed.
 */
export function shellWrites(cmd: string): string[] {
  const out: string[] = []
  const ws = `((?:\\./)?(?:evidence|oracles|obligations|work|analysis|modernized)/${PATHCH}*)`
  for (const m of cmd.matchAll(new RegExp(`(?:^|[^<0-9&])>>?\\s*['"]?${ws}`, 'g'))) out.push(m[1]!)
  for (const m of cmd.matchAll(new RegExp(`\\btee\\s+(?:-a\\s+)?['"]?${ws}`, 'g'))) out.push(m[1]!)
  for (const m of cmd.matchAll(new RegExp(`(?:writeFileSync|appendFileSync|createWriteStream|renameSync|rmSync|unlinkSync)\\(\\s*[\`'"]${ws}`, 'g'))) out.push(m[1]!)
  for (const m of cmd.matchAll(new RegExp(`\\bopen\\(\\s*['"]${ws}['"]\\s*,\\s*['"][wax]`, 'g'))) out.push(m[1]!)
  for (const simple of cmd.split(/\n|;|&&|\|\||\|/)) {
    const words = simple.trim().split(/\s+/).map((w) => w.replace(/^['"]|['"]$/g, ''))
    const verb = words[0] ?? ''
    const args = words.slice(1).filter((w) => !w.startsWith('-'))
    const isWs = (w: string) => /^(?:\.\/)?(?:evidence|oracles|obligations|work|analysis|modernized)\//.test(w)
    if (['cp', 'mv', 'ln', 'install', 'rsync'].includes(verb) && args.length >= 2 && isWs(args.at(-1)!)) out.push(args.at(-1)!)
    if (['rm', 'touch', 'truncate', 'mkdir', 'rmdir', 'shred'].includes(verb)) out.push(...args.filter(isWs))
    if ((verb === 'sed' && words.some((w) => /^-i/.test(w))) || (verb === 'perl' && words.some((w) => /^-\w*i/.test(w)))) out.push(...args.filter(isWs))
  }
  return [...new Set(out.map(strip))]
}

export function decide(inp: Input, root: string): string | null {
  const tool = inp.tool_name ?? ''
  const who = role(inp.agent_type)
  const sub = Boolean(inp.agent_type)
  const files = tool === 'Bash' ? [] : pathsOf(inp, root)
  const cmd = tool === 'Bash' ? String(inp.tool_input?.['command'] ?? '') : ''
  const shellPaths = tool === 'Bash' ? bashMentions(cmd) : []
  const viaProofScript = /rig_proof\.ts\b/.test(cmd)

  // 1. script-only paths
  if (WRITE_TOOLS.has(tool)) {
    const p = files.find((f) => SCRIPT_ONLY.some((r) => r.test(f)))
    if (p) return `${p} is written only by rig_proof.ts (evidence, cases and sets are never edited by hand)`
  }
  const written = tool === 'Bash' ? shellWrites(cmd) : []
  if (tool === 'Bash' && !viaProofScript) {
    const p = written.find((f) => SCRIPT_ONLY.some((r) => r.test(f)))
    if (p) return `${p} is written only by rig_proof.ts; this command looks like it writes there`
  }

  // 2. person-only decisions
  if (sub) {
    if (WRITE_TOOLS.has(tool)) {
      const p = files.find((f) => PERSON_ONLY.some((r) => r.test(f)))
      if (p) return `${p} records a person's decision; a subagent may not write it`
    }
    if (tool === 'Bash' && !viaProofScript) {
      const p = written.find((f) => PERSON_ONLY.some((r) => r.test(f)))
      if (p) return `${p} records a person's decision; a subagent may not write it`
    }
  }

  // 3. workers and fixers never see the oracle
  if (who === 'worker' || who === 'fixer') {
    const touched = tool === 'Bash' ? shellPaths : files
    const p = touched.find((f) => HIDDEN_FROM_WORKERS.some((r) => r.test(f)))
    if (p) return `${p} is hidden from the ${who}: it learns about failures only through the counts per class it is given`
    if (tool === 'Bash' && viaProofScript) return `the ${who} may not run rig_proof.ts`
  }

  // 4. reviewers see only their packet
  if (who === 'reviewer-a' || who === 'reviewer-b') {
    if (READ_TOOLS.has(tool) || tool === 'Bash') {
      const packet = who === 'reviewer-a' ? /^work\/[^/]+\/[^/]+\/review-a\d*(\/|$)/ : /^(work\/[^/]+\/[^/]+\/review-b\d*(\/|$)|legacy(\/|$))/
      const touched = tool === 'Bash' ? shellPaths : files
      const all = tool === 'Bash' ? touched : files
      const t = inp.tool_input ?? {}
      const named = [t['file_path'], t['path']].filter((x): x is string => typeof x === 'string' && x !== '')
      if (tool === 'Read' && named.length === 1 && TOOL_RESULTS.test(normalize(named[0]!))) return null
      if (tool !== 'Bash' && files.length === 0 && READ_TOOLS.has(tool)) return `${who} must name a path inside its packet`
      const p = all.find((f) => !packet.test(f))
      if (p) return `${who} reads only its packet; ${p} is outside it`
    }
  }
  return null
}

function main(): void {
  let inp: Input
  try {
    inp = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return // not our input: allow
  }
  const root = process.env['CLAUDE_PROJECT_DIR'] ?? inp.cwd ?? process.cwd()
  const reason = decide(inp, root)
  if (reason === null) return
  // Every denial is recorded by the guard itself, so a run's report cannot leave one out (M3 exit run 2 did).
  try {
    mkdirSync(join(root, '.rig'), { recursive: true })
    appendFileSync(join(root, '.rig', 'guard.jsonl'), JSON.stringify({ ts: new Date().toISOString(), agent_type: inp.agent_type ?? null,
      tool: inp.tool_name, input: JSON.stringify(inp.tool_input ?? {}).slice(0, 300), reason }) + '\n')
  } catch { /* recording must never turn a deny into an allow */ }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `RIG guard: ${reason}` },
  }))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) main()
