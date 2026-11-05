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
 * 4. `rig:reviewer-a` reads only its packet `work/<system>/<WU>/review-a/` (the diff), and `rig:reviewer-b` reads only
 *    `work/<system>/<WU>/review-b/` and the legacy tree.
 *
 * The guard is a second line of defence: the commands already say all this. It matches paths in file tools exactly
 * and in Bash commands by pattern, so a determined script could still get round it. The hard boundary is the
 * operating system (a sandbox, or separate checkouts).
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'

type Input = { tool_name?: string; tool_input?: Record<string, unknown>; agent_type?: string; cwd?: string }

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])

const SCRIPT_ONLY = [/^evidence\//, /^oracles\/[^/]+\/cases\//, /^oracles\/[^/]+\/sets\//]
const PERSON_ONLY = [/^obligations\//, /^oracles\/[^/]+\/caps\//, /^analysis\/[^/]+\/attestations\.yaml$/]
const HIDDEN_FROM_WORKERS = [/^oracles(\/|$)/, /^evidence(\/|$)/, /^obligations(\/|$)/, /^work\/[^/]+\/[^/]+\/(judge|review-[abc])(\/|$)/]

const role = (agentType?: string) => (agentType ?? '').replace(/^rig:/, '')

/** Paths a tool call touches, relative to the workspace. `null` for paths outside it. */
function pathsOf(inp: Input, root: string): string[] {
  const t = inp.tool_input ?? {}
  const raw = [t['file_path'], t['notebook_path'], t['path']].filter((x): x is string => typeof x === 'string' && x !== '')
  if (inp.tool_name === 'Glob' && typeof t['pattern'] === 'string') raw.push(String(t['pattern']))
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

const WRITES_IN_SHELL = /(>>?|\btee\b|\brm\b|\bmv\b|\bcp\b|\bsed\s+-i|\bperl\s+-[a-z]*i|\btruncate\b|\bln\b|\bmkdir\b|\btouch\b|\bdd\b|writeFileSync|open\([^)]*['"][wa])/

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
  if (tool === 'Bash' && !viaProofScript && WRITES_IN_SHELL.test(cmd)) {
    const p = shellPaths.find((f) => SCRIPT_ONLY.some((r) => r.test(f)))
    if (p && !/^evidence\/[^/]+\/\.obs\//.test(p)) return `${p} is written only by rig_proof.ts; this command looks like it writes there`
  }

  // 2. person-only decisions
  if (sub) {
    if (WRITE_TOOLS.has(tool)) {
      const p = files.find((f) => PERSON_ONLY.some((r) => r.test(f)))
      if (p) return `${p} records a person's decision; a subagent may not write it`
    }
    if (tool === 'Bash' && WRITES_IN_SHELL.test(cmd) && !viaProofScript) {
      const p = shellPaths.find((f) => PERSON_ONLY.some((r) => r.test(f)))
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
      const packet = who === 'reviewer-a' ? /^work\/[^/]+\/[^/]+\/review-a\// : /^(work\/[^/]+\/[^/]+\/review-b\/|legacy\/)/
      const touched = tool === 'Bash' ? shellPaths : files
      const all = tool === 'Bash' ? touched : files
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
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `RIG guard: ${reason}` },
  }))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) main()
