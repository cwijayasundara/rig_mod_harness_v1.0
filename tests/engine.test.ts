/** Engine behaviour: retries, budgets, escalation, dependencies, pause and resume, locking. */

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'

import { acquireLock, exitCode, fold, RunLocked, Runner } from '../src/engine.ts'
import { readEvents } from '../src/events.ts'
import type { Workspace } from '../src/workspace.ts'
import { checkLog, noopWorkspace, setAgent, setProgrammeTokens, writeWu } from './helpers.ts'

const stateOf = (ws: Workspace) =>
  Object.fromEntries([...fold(readEvents(ws.eventsPath)).units].map(([id, u]) => [id, u.state]))

test('a no-op programme runs end to end, in dependency order', async () => {
  const ws = noopWorkspace()
  const r = await new Runner(ws).run()
  assert.equal(r.status, 'finished')
  assert.equal(exitCode(r), 0)
  assert.deepEqual(stateOf(ws), { 'WU-N-0001': 'merged', 'WU-N-0002': 'merged', 'WU-N-0003': 'merged' })
  const evs = readEvents(ws.eventsPath)
  checkLog(evs)
  assert.deepEqual(evs.filter((e) => e.type === 'wu_started').map((e) => e['wu']), ['WU-N-0001', 'WU-N-0002', 'WU-N-0003'])
})

test('re-running a finished programme does nothing', async () => {
  const ws = noopWorkspace()
  await new Runner(ws).run()
  const n = readEvents(ws.eventsPath).length
  await new Runner(ws).run()
  assert.deepEqual(readEvents(ws.eventsPath).slice(n).map((e) => e.type), ['run_started', 'run_finished'])
})

test('judge retry starts a new attempt', async () => {
  const ws = noopWorkspace()
  setAgent(ws, 'scripted', { script: { 'WU-N-0001:judge:1': 'retry', 'WU-N-0002:self_check:1': 'fail' } })
  await new Runner(ws).run()
  const ps = fold(readEvents(ws.eventsPath))
  assert.equal(ps.units.get('WU-N-0001')!.state, 'merged')
  assert.equal(ps.units.get('WU-N-0001')!.attempt, 2)
  assert.equal(ps.units.get('WU-N-0002')!.attempt, 2)
  checkLog(readEvents(ws.eventsPath))
})

test('the attempts budget escalates, and dependents are blocked', async () => {
  const ws = noopWorkspace()
  setAgent(ws, 'scripted', { script: { 'WU-N-0001:judge:*': 'retry' } })
  const r = await new Runner(ws).run()
  assert.equal(exitCode(r), 1)
  assert.deepEqual(r.summary.escalated, ['WU-N-0001'])
  assert.deepEqual(r.summary.blocked, ['WU-N-0002', 'WU-N-0003'])
  const u = fold(readEvents(ws.eventsPath)).units.get('WU-N-0001')!
  assert.equal(u.attempt, 4) // attempts: 3, so attempt 4 never runs a stage
  assert.match(u.escalationReason!, /attempts 4 > 3/)
  checkLog(readEvents(ws.eventsPath))
})

test('the token budget escalates, and cost is tracked by role', async () => {
  const ws = noopWorkspace()
  writeWu(ws, { id: 'WU-N-0001', type: 'noop', budget: { tokens: 250 } })
  setAgent(ws, 'noop', { tokens_per_call: 100 })
  await new Runner(ws).run()
  const u = fold(readEvents(ws.eventsPath)).units.get('WU-N-0001')!
  assert.equal(u.state, 'escalated')
  assert.equal(u.usage.tokens, 300) // implement, review_a, review_b
  assert.deepEqual(u.tokensByRole, { harness: 0, worker: 100, 'reviewer-a': 100, 'reviewer-b': 100 })
})

test('the programme token budget halts the run without escalating anyone', async () => {
  const ws = noopWorkspace()
  setAgent(ws, 'noop', { tokens_per_call: 100 })
  setProgrammeTokens(ws, 500)
  const r = await new Runner(ws).run()
  assert.equal(r.status, 'halted')
  assert.equal(exitCode(r), 3)
  assert.ok(!Object.values(stateOf(ws)).includes('escalated'))
})

test('an adapter error or an illegal outcome escalates the unit', async () => {
  const ws = noopWorkspace()
  setAgent(ws, 'scripted', { script: { 'WU-N-0002:implement:1': 'error', 'WU-N-0003:review_a:1': 'merged' } })
  const r = await new Runner(ws).run()
  assert.deepEqual(r.summary.escalated.sort(), ['WU-N-0002', 'WU-N-0003'])
  assert.equal(stateOf(ws)['WU-N-0001'], 'merged')
  checkLog(readEvents(ws.eventsPath))
})

test('provisional satisfies a dependency', async () => {
  const ws = noopWorkspace()
  setAgent(ws, 'scripted', { script: { 'WU-N-0001:judge:1': 'provisional' } })
  assert.equal(exitCode(await new Runner(ws).run()), 0)
  assert.deepEqual(stateOf(ws), { 'WU-N-0001': 'provisional', 'WU-N-0002': 'merged', 'WU-N-0003': 'merged' })
})

test('pausing every 2 stages and resuming reaches the same end state', async () => {
  const ws = noopWorkspace()
  for (let i = 0; i < 100; i++) if ((await new Runner(ws).run({ maxStages: 2 })).status === 'finished') break
  assert.deepEqual(new Set(Object.values(stateOf(ws))), new Set(['merged']))
  checkLog(readEvents(ws.eventsPath))
})

test('a contract may change while queued, but not after the unit started', async () => {
  const ws = noopWorkspace()
  await new Runner(ws).run({ maxStages: 3 }) // only WU-N-0001 has started
  writeWu(ws, { id: 'WU-N-0003', type: 'noop', depends_on: ['WU-N-0001'], budget: { attempts: 9 } })
  await new Runner(ws).run({ maxStages: 1 })
  writeWu(ws, { id: 'WU-N-0001', type: 'noop', budget: { attempts: 9 } })
  await assert.rejects(new Runner(ws).run(), /contract changed after the unit started/)
})

test('a second runner is locked out; a stale lock is taken over', async () => {
  const ws = noopWorkspace()
  const release = acquireLock(ws)
  await assert.rejects(new Runner(ws).run(), RunLocked)
  release()
  writeFileSync(ws.lockPath, '999999\n') // a dead pid
  assert.equal((await new Runner(ws).run()).status, 'finished')
})
