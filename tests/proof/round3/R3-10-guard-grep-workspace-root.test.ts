/**
 * R3-10: the Grep tool searches its `path`, or the working directory when none is given. pathsOf() then yields no
 * path (or "" for "."), which no HIDDEN_FROM_WORKERS pattern matches, so a worker's ordinary
 * `Grep {pattern: "expected", output_mode: "content"}` at the workspace root prints sealed cases and evidence.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decide } from '../../../plugins/rig/hooks/guard.ts'

const ROOT = '/ws'
const grep = (input: Record<string, unknown>) => decide({ tool_name: 'Grep', tool_input: input, cwd: ROOT, agent_type: 'rig:worker' }, ROOT)

test('a worker may not Grep a tree that contains oracles/ and evidence/', () => {
  assert.notEqual(grep({ pattern: 'expected', path: 'oracles' }), null) // control
  assert.notEqual(grep({ pattern: 'expected', output_mode: 'content' }), null, 'Grep with no path searched the whole workspace')
  assert.notEqual(grep({ pattern: 'expected', path: '/ws', output_mode: 'content' }), null, 'Grep of the workspace root allowed')
  assert.notEqual(grep({ pattern: 'expected', path: '.', glob: 'oracles/**' }), null, 'Grep of "." limited to oracles/** allowed')
})
