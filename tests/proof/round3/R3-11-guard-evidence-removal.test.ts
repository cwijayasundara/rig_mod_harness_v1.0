/**
 * R3-11: shellWrites() treats only the destination of cp/mv as written, and requires a trailing `/` after the protected
 * directory name. `mv evidence/<sys>/<key>/<failing run> /tmp/` therefore passes, although it removes a run from
 * evidence: the verdict then reads only the passing reruns ("reruns never clear a failure" no longer holds).
 * `rm -rf obligations` by a subagent passes for the same reason.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decide } from '../../../plugins/rig/hooks/guard.ts'

const ROOT = '/ws'
const bash = (command: string, agent?: string) =>
  decide({ tool_name: 'Bash', tool_input: { command }, cwd: ROOT, ...(agent && { agent_type: agent }) }, ROOT)

test('moving a run out of evidence/ is a write to evidence/', () => {
  assert.notEqual(bash('rm -rf evidence/sys/K1/20261106T0101-abc'), null) // control: rm is caught
  assert.notEqual(bash('mv evidence/sys/K1/20261106T0101-abc /tmp/'), null, 'mv removed a failing run from evidence')
})

test('a subagent may not delete the protected directories themselves', () => {
  assert.notEqual(bash('rm -rf obligations', 'rig:fixer'), null, 'a subagent deleted every obligation')
  assert.notEqual(bash('rm -rf evidence'), null, 'all evidence deleted')
})
