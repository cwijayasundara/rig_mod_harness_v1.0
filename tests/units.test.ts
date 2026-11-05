/** Unit tests: state machine, budgets, event log, workspace. */

import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { exceeded, newUsage, parseBudget, parseDuration, parseTokens } from '../src/budget.ts'
import { EventLog, LogCorrupt, readEvents } from '../src/events.ts'
import { DEFAULT_OUTCOME, IllegalTransition, nextState, OUTCOMES, ROLE, STAGES, TERMINAL, type State } from '../src/states.ts'
import { LAYOUT_DIRS, Workspace, WorkspaceError } from '../src/workspace.ts'
import { noopWorkspace, tmp, writeWu } from './helpers.ts'

describe('state machine', () => {
  test('the happy path walks every stage once, in order', () => {
    const seen: State[] = []
    let s: State = 'context_build'
    while (!TERMINAL.has(s)) {
      seen.push(s)
      s = nextState(s as (typeof STAGES)[number], DEFAULT_OUTCOME[s as (typeof STAGES)[number]])
    }
    assert.deepEqual(seen, [...STAGES])
    assert.equal(s, 'merged')
  })

  test('branching outcomes', () => {
    assert.equal(nextState('judge', 'retry'), 'context_build')
    assert.equal(nextState('judge', 'provisional'), 'provisional')
    assert.equal(nextState('judge', 'escalate'), 'escalated')
    assert.equal(nextState('self_check', 'fail'), 'context_build')
  })

  test('illegal outcomes throw', () => {
    assert.throws(() => nextState('implement', 'merged'), IllegalTransition)
    assert.throws(() => nextState('judge', 'toString'), IllegalTransition)
  })

  test('every stage has a role and outcomes', () => {
    assert.deepEqual(Object.keys(ROLE), [...STAGES])
    assert.deepEqual(Object.keys(OUTCOMES), [...STAGES])
  })
})

describe('budgets', () => {
  test('parsing', () => {
    assert.equal(parseTokens('2.5M'), 2_500_000)
    assert.equal(parseTokens('800k'), 800_000)
    assert.equal(parseTokens(12), 12)
    assert.equal(parseDuration('45m'), 2700)
    assert.equal(parseDuration('1h'), 3600)
    assert.equal(parseDuration('90'), 90)
    assert.deepEqual(parseBudget({ tokens: '2.5M', wallclock: '45m', attempts: 3 }), { tokens: 2_500_000, wallclockS: 2700, attempts: 3 })
    assert.throws(() => parseBudget({ cost: 1 }), /unknown budget keys/)
    assert.throws(() => parseBudget({ attempts: 0 }), /attempts/)
    assert.throws(() => parseTokens('lots'), /bad token/)
    assert.throws(() => parseTokens('5x'), /bad token/)
  })

  test('exceeded', () => {
    const b = { tokens: 100, wallclockS: 10, attempts: 2 }
    assert.equal(exceeded(b, { tokens: 99, wallclockS: 9.9, attempts: 2 }), null)
    assert.match(exceeded(b, { ...newUsage(), tokens: 100 })!, /tokens/)
    assert.match(exceeded(b, { ...newUsage(), wallclockS: 10 })!, /wallclock/)
    assert.match(exceeded(b, { ...newUsage(), attempts: 3 })!, /attempts/)
    assert.equal(exceeded({ tokens: null, wallclockS: null, attempts: null }, { tokens: 1e12, wallclockS: 1e9, attempts: 99 }), null)
  })
})

describe('event log', () => {
  test('round trip and continued seq', () => {
    const p = join(tmp(), 'events.jsonl')
    const log = new EventLog(p).open()
    log.append('a', { x: 1 })
    log.append('b')
    log.close()
    const again = new EventLog(p).open()
    assert.deepEqual(again.events.map((e) => e.type), ['a', 'b'])
    assert.equal(again.append('c').seq, 3)
    again.close()
  })

  test('a torn tail is truncated and recorded', () => {
    const p = join(tmp(), 'events.jsonl')
    const log = new EventLog(p).open()
    log.append('a')
    log.close()
    const torn = '{"seq":2,"ts":"x","type":"stage_comp'
    appendFileSync(p, torn) // killed mid-write
    const again = new EventLog(p).open()
    assert.deepEqual(again.events.map((e) => e.type), ['a', 'log_repaired'])
    again.close()
    assert.equal(readEvents(p).at(-1)!['dropped_bytes'], torn.length)
  })

  test('corruption and seq gaps are rejected', () => {
    const p = join(tmp(), 'events.jsonl')
    writeFileSync(p, '{"seq":1,"type":"a"}\nnot json\n{"seq":3,"type":"c"}\n')
    assert.throws(() => new EventLog(p).open(), LogCorrupt)
    writeFileSync(p, '{"seq":1,"type":"a"}\n{"seq":3,"type":"c"}\n')
    assert.throws(() => new EventLog(p).open(), LogCorrupt)
  })
})

describe('workspace', () => {
  test('init creates the §10 layout', () => {
    const base = tmp()
    const legacy = join(base, 'carddemo')
    mkdirSync(legacy)
    const ws = Workspace.init(join(base, 'prog'), { name: 'p', legacy, example: 'noop' })
    for (const d of LAYOUT_DIRS) assert.ok(statSync(join(ws.root, d)).isDirectory(), d)
    for (const f of ['INTENT.md', 'PREFLIGHT.md', 'PROGRAMME.yaml', 'VERIFICATION.md', 'CUTOVER.md']) {
      assert.ok(existsSync(join(ws.root, f)), f)
    }
    assert.equal(realpathSync(join(ws.root, 'legacy', 'carddemo')), realpathSync(legacy))
    assert.equal(ws.loadWorkUnits().size, 3)
    assert.equal(Workspace.find(join(ws.root, 'work')).root, ws.root)
    assert.throws(() => Workspace.init(ws.root, { name: 'again' }), WorkspaceError)
  })

  test('bad units are rejected', () => {
    const ws = noopWorkspace()
    writeWu(ws, { id: 'WU-X-1', type: 'frobnicate' })
    assert.throws(() => ws.loadWorkUnits(), /unknown type/)
    writeWu(ws, { id: 'WU-X-1', type: 'noop', depends_on: ['WU-NOPE'] })
    assert.throws(() => ws.loadWorkUnits(), /unknown unit/)
    writeWu(ws, { id: 'WU-X-1', type: 'noop', depends_on: ['WU-X-2'] })
    writeWu(ws, { id: 'WU-X-2', type: 'noop', depends_on: ['WU-X-1'] })
    assert.throws(() => ws.loadWorkUnits(), /cycle/)
  })
})
