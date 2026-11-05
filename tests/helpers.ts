import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse } from 'yaml'

import type { Event } from '../src/events.ts'
import { isRetry, nextState, TERMINAL, type Stage, type State } from '../src/states.ts'
import { Workspace, writeYaml } from '../src/workspace.ts'

export const tmp = (): string => mkdtempSync(join(tmpdir(), 'rig-test-'))

export const noopWorkspace = (): Workspace => Workspace.init(join(tmp(), 'prog'), { name: 'test', example: 'noop' })

function editProgramme(ws: Workspace, edit: (raw: Record<string, unknown>) => void): void {
  const raw = parse(readFileSync(ws.programmePath, 'utf8')) as Record<string, unknown>
  edit(raw)
  writeYaml(ws.programmePath, raw)
}

export const setAgent = (ws: Workspace, adapter: string, options: Record<string, unknown> = {}) =>
  editProgramme(ws, (raw) => { raw['agent'] = { adapter, options } })

export const setProgrammeTokens = (ws: Workspace, tokens: unknown) =>
  editProgramme(ws, (raw) => { raw['budget'] = { tokens } })

export const writeWu = (ws: Workspace, wu: Record<string, unknown>) => writeYaml(join(ws.workDir, `${wu['id']}.yaml`), wu)

/** Invariants every event log must satisfy, however often its runs were killed. */
export function checkLog(events: readonly Event[]): void {
  assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i + 1), 'seq is contiguous')
  const state = new Map<string, State>()
  const attempt = new Map<string, number>()
  const terminalHits = new Map<string, number>()
  const at = (wu: unknown) => state.get(String(wu)) ?? 'queued'
  const hit = (wu: string) => terminalHits.set(wu, (terminalHits.get(wu) ?? 0) + 1)
  for (const e of events) {
    const wu = String(e['wu'])
    switch (e.type) {
      case 'wu_started':
        assert.equal(at(wu), 'queued')
        state.set(wu, 'context_build')
        break
      case 'stage_started':
        assert.equal(e['stage'], at(wu), `${wu}: stage ${e['stage']} started in ${at(wu)}`)
        assert.equal(e['attempt'], attempt.get(wu) ?? 1)
        break
      case 'stage_completed': {
        assert.equal(e['stage'], at(wu))
        const to = nextState(e['stage'] as Stage, String(e['outcome']))
        assert.equal(to, e['to'])
        state.set(wu, to)
        if (isRetry(e['stage'] as Stage, String(e['outcome']))) attempt.set(wu, (attempt.get(wu) ?? 1) + 1)
        if (TERMINAL.has(to)) hit(wu)
        break
      }
      case 'escalated':
        assert.ok(!TERMINAL.has(at(wu)), `${wu} escalated from terminal ${at(wu)}`)
        state.set(wu, 'escalated')
        hit(wu)
        break
    }
  }
  for (const [wu, n] of terminalHits) assert.equal(n, 1, `${wu} reached a terminal state ${n} times`)
}
