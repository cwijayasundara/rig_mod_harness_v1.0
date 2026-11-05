/** Tests for the RIG integrity guard (plugins/rig/hooks/guard.ts). */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'

import { decide } from '../../plugins/rig/hooks/guard.ts'

const ROOT = '/ws'
const GUARD = resolve(import.meta.dirname, '../../plugins/rig/hooks/guard.ts')
const call = (tool: string, input: Record<string, unknown>, agent?: string) =>
  decide({ tool_name: tool, tool_input: input, cwd: ROOT, ...(agent && { agent_type: agent }) }, ROOT)

describe('script-only paths', () => {
  test('nobody writes evidence, cases or sets with a file tool', () => {
    for (const p of ['/ws/evidence/sys/K/r/run.json', 'oracles/sys/cases/abc.json', 'oracles/sys/sets/S.json']) {
      assert.match(call('Write', { file_path: p }) ?? '', /written only by rig_proof/, p)
    }
  })
  test('nor with a shell redirect, but rig_proof.ts may', () => {
    assert.match(call('Bash', { command: 'echo {} > evidence/sys/K/r/run.json' }) ?? '', /rig_proof/)
    assert.equal(call('Bash', { command: 'node /p/scripts/rig_proof.ts judge --ws . --system sys --set S' }), null)
  })
  test('observation scratch folders are allowed', () => {
    assert.equal(call('Bash', { command: 'mkdir -p evidence/sys/.obs/r1/legacy' }), null)
  })
  test('reading evidence is fine for the main session', () => {
    assert.equal(call('Read', { file_path: '/ws/evidence/sys/K/r/run.json' }), null)
  })
})

describe('person-only decisions', () => {
  test('a subagent may not accept an obligation or sign a cap', () => {
    assert.match(call('Edit', { file_path: 'obligations/sys/OBL-1.json' }, 'rig:judge') ?? '', /person's decision/)
    assert.match(call('Write', { file_path: 'oracles/sys/caps/CAP-1.json' }, 'rig:oracle-engineer') ?? '', /person's decision/)
    assert.match(call('Bash', { command: "sed -i '' s/null/me/ obligations/sys/OBL-1.json" }, 'rig:fixer') ?? '', /person's decision|hidden/)
  })
  test('the main session may, through /rig:review', () => {
    assert.equal(call('Edit', { file_path: 'obligations/sys/OBL-1.json' }), null)
  })
})

describe('workers never see the oracle', () => {
  for (const who of ['rig:worker', 'rig:fixer']) {
    test(`${who}: no oracles, evidence, obligations, judge or review folders`, () => {
      assert.match(call('Read', { file_path: 'oracles/sys/cases/abc.json' }, who) ?? '', /hidden/)
      assert.match(call('Grep', { pattern: 'x', path: 'evidence' }, who) ?? '', /hidden/)
      assert.match(call('Glob', { pattern: 'oracles/**/*.json' }, who) ?? '', /hidden/)
      assert.match(call('Bash', { command: 'cat oracles/sys/sets/S.json' }, who) ?? '', /hidden/)
      assert.match(call('Read', { file_path: 'work/sys/WU-1/judge/out.json' }, who) ?? '', /hidden/)
      assert.match(call('Bash', { command: 'node x/rig_proof.ts verdict' }, who) ?? '', /may not run rig_proof/)
    })
    test(`${who}: its own code and the legacy tree are fine`, () => {
      assert.equal(call('Read', { file_path: 'legacy/carddemo/app/cbl/CBACT04C.cbl' }, who), null)
      assert.equal(call('Write', { file_path: 'modernized/intcalc/src/Main.java' }, who), null)
      assert.equal(call('Read', { file_path: 'work/sys/WU-1/brief.md' }, who), null)
    })
  }
})

describe('reviewers see only their packet', () => {
  test('reviewer A: the diff packet only', () => {
    assert.equal(call('Read', { file_path: 'work/sys/WU-1/review-a/diff.patch' }, 'rig:reviewer-a'), null)
    assert.match(call('Read', { file_path: 'legacy/carddemo/app/cbl/X.cbl' }, 'rig:reviewer-a') ?? '', /outside/)
    assert.match(call('Read', { file_path: 'modernized/x/Main.java' }, 'rig:reviewer-a') ?? '', /outside/)
  })
  test('reviewer B: its packet and the legacy tree', () => {
    assert.equal(call('Read', { file_path: 'work/sys/WU-1/review-b/spec.md' }, 'rig:reviewer-b'), null)
    assert.equal(call('Read', { file_path: 'legacy/carddemo/app/cbl/X.cbl' }, 'rig:reviewer-b'), null)
    assert.match(call('Read', { file_path: 'work/sys/WU-1/review-a/diff.patch' }, 'rig:reviewer-b') ?? '', /outside/)
  })
})

test('the hook prints a deny decision on stdout', () => {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join('/ws', 'evidence/sys/K/r/run.json') }, cwd: '/ws' })
  const out = spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '/ws' } })
  assert.equal(out.status, 0)
  const d = JSON.parse(out.stdout)
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny')
  const ok = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/ws/legacy/a' }, cwd: '/ws' }), encoding: 'utf8' })
  assert.equal(ok.stdout, '')
})
