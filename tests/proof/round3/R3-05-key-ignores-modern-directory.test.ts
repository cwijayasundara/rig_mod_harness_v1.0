/**
 * R3-05: evidenceKey hashes each `--modern` path with hashFiles(), which writes '<absent>' for anything that is not a
 * regular file. commands/judge.md asks for "the compiled output that actually ran (classes, jars)", so a classes
 * directory (or a typo'd path) is a natural argument, and the key then stays the same however the code in it changes.
 * Old PROVEN evidence keeps applying to new code. Rule A: a path that hashes nothing must fail closed.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import * as P from '../../../plugins/rig/scripts/rig_proof.ts'

test('changing a class file under a --modern directory changes the key (or the directory is refused)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-05-'))
  try {
    const ws = new P.WS(dir, 'sys')
    mkdirSync(join(dir, 'legacy', 'jcl'), { recursive: true })
    writeFileSync(join(dir, 'legacy', 'jcl', 'INTJOB.jcl'), '//S1 EXEC PGM=A')
    P.dump(join(ws.analysis, 'graph.json'), { nodes: [{ id: 'job:INTJOB', loc: 'jcl/INTJOB.jcl:1' }], edges: [] })
    const cls = join(dir, 'modernized', 'target', 'classes')
    mkdirSync(cls, { recursive: true })
    const key = () => P.evidenceKey(ws, 'job:INTJOB', 'V3', join(dir, 'legacy'), ['modernized/target/classes'], undefined, [], {}, {})['key']
    writeFileSync(join(cls, 'IntCalc.class'), 'version 1: correct interest')
    let k1: string
    try { k1 = key() } catch { return } // refusing a directory is a correct fix
    writeFileSync(join(cls, 'IntCalc.class'), 'version 2: interest rounded differently')
    assert.notEqual(key(), k1, 'the modern code changed but the evidence key did not')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a --modern path that does not exist is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-r3-05b-'))
  try {
    const ws = new P.WS(dir, 'sys')
    mkdirSync(join(dir, 'legacy', 'jcl'), { recursive: true })
    writeFileSync(join(dir, 'legacy', 'jcl', 'INTJOB.jcl'), '//S1 EXEC PGM=A')
    P.dump(join(ws.analysis, 'graph.json'), { nodes: [{ id: 'job:INTJOB', loc: 'jcl/INTJOB.jcl:1' }], edges: [] })
    assert.throws(() => P.evidenceKey(ws, 'job:INTJOB', 'V3', join(dir, 'legacy'), ['modernized/IntCalc.jav'], undefined, [], {}, {}),
      'a modern path that hashes nothing gave a key')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
