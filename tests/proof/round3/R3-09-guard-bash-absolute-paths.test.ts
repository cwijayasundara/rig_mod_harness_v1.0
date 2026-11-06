/**
 * R3-09: guard.ts matches Bash paths only when they are written workspace-relative. bashMentions() needs `oracles/`
 * etc. right after whitespace, a quote or an operator, and shellWrites() needs them right after `>`, `tee`, or as a cp/mv
 * argument. An absolute path (the form Claude Code agents are told to use) has `/` before `oracles`, so a worker can
 * `cat` sealed cases and any agent can redirect into evidence/.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decide } from '../../../plugins/rig/hooks/guard.ts'

const ROOT = '/ws'
const bash = (command: string, agent?: string) =>
  decide({ tool_name: 'Bash', tool_input: { command }, cwd: ROOT, ...(agent && { agent_type: agent }) }, ROOT)

test('a worker may not read sealed cases by absolute path', () => {
  assert.equal(bash('cat oracles/sys/cases/abc.json', 'rig:worker') !== null, true) // control: relative is denied
  assert.notEqual(bash('cat /ws/oracles/sys/cases/abc.json', 'rig:worker'), null, 'worker read a sealed case by absolute path')
})

test('nobody writes evidence by redirecting to an absolute path', () => {
  assert.notEqual(bash('echo x > evidence/sys/K/r/run.json'), null) // control
  assert.notEqual(bash('echo \'{"results":[]}\' > /ws/evidence/sys/K/r/run.json'), null, 'redirect into evidence/ by absolute path allowed')
  assert.notEqual(bash('cp /tmp/run.json /ws/evidence/sys/K/r/run.json', 'rig:fixer'), null, 'cp into evidence/ by absolute path allowed')
})
