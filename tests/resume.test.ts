/**
 * The M0 exit check (PROPOSAL.md §13): a no-op programme runs end to end and
 * resumes after a kill.
 *
 * Each test runs the real CLI in a child process and SIGKILLs it mid-run, then
 * resumes. The log must stay valid, and every unit must reach `merged` exactly once.
 */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'

import { fold } from '../src/engine.ts'
import { readEvents } from '../src/events.ts'
import type { Workspace } from '../src/workspace.ts'
import { checkLog, noopWorkspace, setAgent } from './helpers.ts'

const RIG = join(import.meta.dirname, '..', 'bin', 'rig.js')

const rig = (ws: Workspace, ...args: string[]) =>
  spawnSync(process.execPath, [RIG, ...args, '-C', ws.root], { encoding: 'utf8' })

/** Start `rig run`, wait until the log has at least `after` events, then SIGKILL it. */
async function runAndKill(ws: Workspace, after: number): Promise<void> {
  const child = spawn(process.execPath, [RIG, 'run', '-C', ws.root], { stdio: 'ignore' })
  const exited = new Promise((resolve) => child.on('exit', resolve))
  for (let i = 0; i < 2000 && readEvents(ws.eventsPath).length < after; i++) await sleep(5)
  child.kill('SIGKILL')
  await exited
}

const allMerged = (ws: Workspace) =>
  [...fold(readEvents(ws.eventsPath)).units.values()].every((u) => u.state === 'merged')

test('exit check: killed mid-run, then resumed to completion', async () => {
  const ws = noopWorkspace()
  setAgent(ws, 'noop', { delay_s: 0.02 })
  await runAndKill(ws, 20)

  const before = fold(readEvents(ws.eventsPath))
  assert.equal(before.lastRun?.status, 'running', 'the killed run never finished')
  assert.ok(!allMerged(ws), 'killed before the programme completed')
  assert.ok(existsSync(ws.lockPath), 'the dead runner left its lock behind')

  const st = rig(ws, 'status')
  assert.equal(st.status, 0, st.stderr)
  assert.match(st.stdout, /rig run` resumes it/)

  const r = rig(ws, 'run')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /finished: \{"merged":3\}/)

  const evs = readEvents(ws.eventsPath)
  checkLog(evs)
  assert.ok(allMerged(ws))
  assert.equal(evs.filter((e) => e.type === 'run_resumed').length, 1)
})

test('exit check: repeated kills at different points always converge', async () => {
  const ws = noopWorkspace()
  setAgent(ws, 'noop', { delay_s: 0.01 })
  for (let k = 0; k < 6 && !allMerged(ws); k++) {
    await runAndKill(ws, readEvents(ws.eventsPath).length + 3 + k * 2)
  }
  const r = rig(ws, 'run')
  assert.equal(r.status, 0, r.stderr)
  const evs = readEvents(ws.eventsPath)
  checkLog(evs)
  assert.ok(allMerged(ws))
  // every interrupted stage was recorded, and ran again
  for (const e of evs.filter((x) => x.type === 'stage_interrupted')) {
    assert.ok(evs.some((x) => x.type === 'stage_completed' && x['wu'] === e['wu'] && x['stage'] === e['stage'] && x.seq > e.seq))
  }
})

test('exit check: a write torn by the kill is repaired on resume', async () => {
  const ws = noopWorkspace()
  setAgent(ws, 'noop', { delay_s: 0.02 })
  await runAndKill(ws, 15)
  appendFileSync(ws.eventsPath, '{"seq":999,"type":"stage_compl') // simulate a kill mid-write
  const r = rig(ws, 'run')
  assert.equal(r.status, 0, r.stderr)
  const evs = readEvents(ws.eventsPath)
  checkLog(evs)
  assert.ok(evs.some((e) => e.type === 'log_repaired'))
  assert.ok(allMerged(ws))
})
