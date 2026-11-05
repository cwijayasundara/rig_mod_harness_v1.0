/** Root causes found by the M4 exit run (PetClinic uplift), one test each. */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, test } from 'node:test'

import { decide } from '../../plugins/rig/hooks/guard.ts'
import * as H from '../../plugins/rig/scripts/rig_http.ts'
import * as P from '../../plugins/rig/scripts/rig_proof.ts'

const call = (tool: string, input: Record<string, unknown>, agent?: string) =>
  decide({ tool_name: tool, tool_input: input, cwd: '/ws', ...(agent && { agent_type: agent }) }, '/ws')

describe('observable ids are the ids the comparator records', () => {
  const GU = 'http:GET /owners'
  test('comparator ids pass', () => {
    for (const id of ['GET /owners.screen', 'GET /owners.message', 'GET /owners.return_code', 'GET /owners.abend',
      'GET /owners/owners.field:telephone', 'GET /owners/owners.cardinality', 'GET /owners/owners.store_write']) {
      assert.equal(P.observableIdProblem(GU, id), null, id)
    }
    assert.equal(P.observableIdProblem('job:INTCALC', 'INTCALC/AWS.M2.ACCTDATA.field:ACCT-CURR-BAL'), null)
  })
  test('scenario suffixes and prefixed ids are named, not reported as "never compared"', () => {
    assert.match(P.observableIdProblem(GU, 'GET /owners.screen:200-html-list')!, /scenarios/)
    assert.match(P.observableIdProblem(GU, 'http:GET /owners.screen')!, /start with "GET \/owners\."/)
    assert.match(P.observableIdProblem(GU, 'GET /owners/owners.colour')!, /store-level/)
  })
  test('the comparator emits exactly these ids', () => {
    const o = { screens: [{ status: '200' }], messages: [], return_code: 143, abend: null, stores: { owners: { records: [{ id: '1' }] } } }
    for (const id of P.exactCompare(o, o, P.unitName(GU)).compared) assert.equal(P.observableIdProblem(GU, id), null, id)
  })
})

describe('a gate unit must have a graph node', () => {
  const g = { nodes: [{ id: 'endpoint:GET /owners' }, { id: 'transaction:CC00' }, { id: 'job:INTCALC' }], edges: [] }
  test('http:, tx: and job: map to endpoint:, transaction: and job:', () => {
    assert.equal(P.gateNode(g, 'http:GET /owners'), 'endpoint:GET /owners')
    assert.equal(P.gateNode(g, 'tx:CC00'), 'transaction:CC00')
    assert.equal(P.gateNode(g, 'job:INTCALC'), 'job:INTCALC')
  })
  test('a missing node fails closed instead of hashing no legacy file', () => {
    assert.throws(() => P.gateNode(g, 'http:GET /vets'), /no node endpoint:GET \/vets/)
  })
})

describe('guard gaps from the M4 run', () => {
  test('attempt-2 reviewer packets are readable by their reviewer only', () => {
    assert.equal(call('Read', { file_path: 'work/s/WU-U-0001/review-a2/diff.patch' }, 'rig:reviewer-a'), null)
    assert.equal(call('Glob', { path: 'work/s/WU-U-0001/review-b2', pattern: '**' }, 'rig:reviewer-b'), null)
    assert.match(call('Read', { file_path: 'work/s/WU-U-0001/review-b2/spec.md' }, 'rig:reviewer-a') ?? '', /outside/)
    assert.match(call('Read', { file_path: 'work/s/WU-U-0001/review-a2/diff.patch' }, 'rig:worker') ?? '', /hidden/)
  })
  test("a reviewer may read Claude Code's saved output of its own tool call", () => {
    const p = '/Users/u/.claude/projects/-ws/97c26281-0e05-4258-9e73-322f64133417/tool-results/toolu_01E6A71HNXZFw3UhLhP3a1qe.txt'
    assert.equal(call('Read', { file_path: p }, 'rig:reviewer-b'), null)
    assert.match(call('Read', { file_path: '/Users/u/.claude/projects/-ws/x/other.txt' }, 'rig:reviewer-b') ?? '', /packet/)
  })
})

describe('rig_http.ts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-http-test-'))
  const server = join(dir, 'app.mjs')
  writeFileSync(server, `
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
const port = Number(process.argv[2]); const seen = []
const s = createServer((q, r) => {
  let b = ''; q.on('data', (c) => b += c); q.on('end', () => {
    seen.push({ m: q.method, u: q.url, b, c: q.headers.cookie ?? null, h: q.headers.host })
    if (q.url === '/hang') return
    if (q.url === '/go') { r.writeHead(302, { Location: 'http://' + q.headers.host + '/done', 'Set-Cookie': 'S=1; Path=/' }); return r.end() }
    r.writeHead(200, { 'Content-Type': 'text/html' })
    r.end('<p>' + q.method + ' ' + q.url + ' ' + b + '</p><span class="help-inline">must not<br>be empty</span>')
  })
})
s.listen(port, '127.0.0.1')
process.on('SIGTERM', () => { writeFileSync(process.argv[3] + '/seen.json', JSON.stringify(seen)); process.exit(0) })
`)
  const input = (requests: unknown[], extra: Record<string, unknown> = {}) => {
    const p = join(dir, `in-${Math.random()}.json`)
    writeFileSync(p, JSON.stringify({ records: { requests }, params: {}, clock: null, stores: {}, session: null, ...extra }))
    return p
  }
  const opts = (c: string, more: Record<string, unknown> = {}) => ({ case: c, start: `node ${server} {port} {workdir}`, env: [],
    'startup-timeout': '20', 'request-timeout': '2', host: 'localhost:8080', 'message-class': 'help-inline',
    'stores-cmd': `cat {workdir}/seen.json | node -e "process.stdout.write(JSON.stringify({requests:{records:JSON.parse(require('fs').readFileSync(0,'utf8'))}}))"`, ...more })

  test('replays requests, follows redirects with cookies, records messages, stores and the exit code', async () => {
    const o = await H.run(opts(input([
      { method: 'POST', path: '/owners/new', form: [['lastName', "O'Neil Zürich"], ['a', '1']] },
      { method: 'GET', path: '/go', follow_redirects: true },
    ])))
    assert.equal(o.screens.length, 2)
    assert.equal(o.screens[0].status, '200')
    assert.match(o.screens[0].body, /POST \/owners\/new lastName=O%27Neil\+Z%C3%BCrich&a=1/)
    assert.deepEqual(o.screens[1].redirect_chain, [{ status: '302', location: 'http://localhost:8080/go'.replace('/go', '/done') }])
    assert.deepEqual(o.messages, ['0:must not', '0:be empty', '1:must not', '1:be empty'])
    assert.equal(o.return_code, 0)
    assert.equal(o.abend, null)
    const seen = o.stores.requests.records
    assert.equal(seen[2].c, 'S=1', 'the redirect carried the cookie')
    assert.equal(seen[0].h, 'localhost:8080', 'Host is fixed, so absolute redirects are the same on both sides')
  })
  test('a request that hangs is an observable timeout, not a runner error', async () => {
    const o = await H.run(opts(input([{ method: 'GET', path: '/hang' }, { method: 'GET', path: '/' }])))
    assert.deepEqual(o.screens[0], { status: null, timeout: true })
    assert.equal(o.screens[1].status, '200')
  })
  test('an app that never listens is behaviour (abend), not exit 3', async () => {
    const o = await H.run(opts(input([{ method: 'GET', path: '/' }]), { start: 'exit 7', 'stores-cmd': undefined }))
    assert.equal(o.abend, 'startup_exit:7')
  })
  test('a clock on another day without a wrapper fails closed', async () => {
    await assert.rejects(H.run(opts(input([{ method: 'GET', path: '/' }], { clock: '2001-01-01T00:00:00Z' }))), /clock-wrap/)
  })
  test('input keys are exact', () => {
    const p = join(dir, 'bad.json')
    writeFileSync(p, JSON.stringify({ records: { requests: [{ method: 'GET', path: '/' }] }, params: {} }))
    assert.throws(() => H.loadInput(p), /exactly/)
  })
  test.after(() => rmSync(dir, { recursive: true, force: true }))
})
