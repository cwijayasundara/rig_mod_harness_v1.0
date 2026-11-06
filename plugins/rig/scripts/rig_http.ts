#!/usr/bin/env node
/**
 * RIG HTTP case runner. Node 24+ runs this file directly. No dependencies.
 *
 * Runs one case of an HTTP gate unit against one side (legacy or modern) and writes one observation in the
 * `references/proof.md` format. Both sides run through the same command with the same options; only `--start`
 * (and the environment it needs) differs. The M4 exit run had to write its own 722-line runner; this is the shared one.
 *
 *     node rig_http.ts run --case <case.json|input.json> --out <observation.json> \
 *       --start '<command; {port} and {workdir} are filled in>' \
 *       [--env NAME=VALUE]... [--stores-cmd '<command; prints {"<store>": {"records": [...]}} on stdout>'] \
 *       [--message-class <css class>] [--clock-wrap '<shell prefix; {clock} and {clock_datetime} are filled in>'] \
 *       [--startup-timeout 180] [--request-timeout 30] [--host localhost:8080] [--workdir <empty dir>]
 *
 * What a run does, the same on both sides:
 *  1. Checks the input has exactly the keys records, params, clock, stores, session.
 *  2. Clock. With `clock` set and `--clock-wrap` given, the wrap is put in front of the start command inside the shell.
 *     With libfaketime on macOS: `export DYLD_INSERT_LIBRARIES=/opt/homebrew/lib/faketime/libfaketime.1.dylib
 *     DYLD_FORCE_FLAT_NAMESPACE=1 FAKETIME='@{clock_datetime}';` (on Linux, LD_PRELOAD with the .so). The variables must
 *     be set inside the shell: macOS drops DYLD_* when it starts /bin/sh, so a `faketime` wrapper around it fails. Without a wrapper the date is held only by running on that UTC day. On any other day nothing is
 *     started: it writes `{"not_run": "<reason>"}` as the observation and exits 4, and the judge records the case as
 *     not run (a gap) on both sides. If the day changes during the run, it exits 3 and writes nothing. There is no
 *     Java fake clock built in.
 *  3. Starts `sh -c <start>` in a fresh working directory, in its own process group, with only PATH, HOME=<workdir>,
 *     TZ=UTC, LANG and LC_ALL=en_US.UTF-8, and the `--env` pairs. Nothing else from the caller's environment.
 *     Each `params` key becomes `--key=value` after the start command.
 *  4. Waits until the port accepts a TCP connection (no HTTP probe, so no extra request reaches the app). An app that
 *     exits or never listens is behaviour: `abend` is `startup_exit:<code>` or `startup_timeout`.
 *  5. Replays `records.requests` in order, with a cookie jar seeded from `session.cookies`. A request that gets no
 *     answer in `--request-timeout` seconds is recorded as a screen `{ "status": null, "timeout": true }`; a hang is
 *     an observable difference, not an error of the runner (the M4 run found pages where legacy hangs). The time the
 *     requests took is `elapsed_ms` (start-up and shutdown excluded), which the judge counts as `<U>.timing` (V9).
 *  6. Stops the process group with SIGTERM (SIGKILL after 60 s, `abend: shutdown_timeout`). `return_code` is the exit
 *     code, or 128 + the signal number.
 *  7. Reads the stores with `--stores-cmd` after shutdown. A failing or unparsable stores command exits 3. A store may
 *     carry `semantics` (probe results) beside its records; it is kept as printed and compared as `store_semantics`.
 *
 * Request keys: method, path (sent as written), query and form (lists of [name, value] or an object, UTF-8
 * form-encoded), body (raw UTF-8), headers, follow_redirects (same host, up to 10), record_headers. The runner adds
 * only `Host` (from `--host`) when none is given, `Cookie` from the jar when none is given, and `Content-Type` for a
 * form. No `Accept` is sent unless the case gives one.
 *
 * Observation: { screens: [{status, headers: {content-type, location, ...record_headers}, body, body_encoding,
 * redirect_chain?}], messages: ["<screen index>:<text>"], stores, return_code, abend, notes }.
 * `messages` are the texts inside elements with `--message-class`, one per element, whitespace collapsed.
 *
 * Exit: 0 observation written; 2 bad input; 3 the run could not be made or trusted, and nothing is written; 4 the case
 * cannot run here (its clock), and `{"not_run"}` is written.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

type Obj = Record<string, any>
type Screen = Obj

class Bad extends Error { override name = 'Bad' }
class Untrusted extends Error { override name = 'Untrusted' }
/** The case cannot run in this environment at all, the same on either side: recorded as not run, never dropped. */
class NotRun extends Error { override name = 'NotRun' }

const INPUT_KEYS = ['clock', 'params', 'records', 'session', 'stores']
const REQUEST_KEYS = new Set(['method', 'path', 'query', 'form', 'body', 'headers', 'follow_redirects', 'record_headers'])

export function loadInput(path: string): Obj {
  let c: Obj
  try { c = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { throw new Bad(`${path}: ${(e as Error).message}`) }
  const inp: Obj = c['input'] ?? c
  const keys = Object.keys(inp).sort()
  if (keys.join(',') !== INPUT_KEYS.join(',')) throw new Bad(`input keys must be exactly ${INPUT_KEYS.join(', ')}; got ${keys.join(', ')}`)
  const reqs = inp['records']?.['requests']
  if (!Array.isArray(reqs) || reqs.length === 0) throw new Bad('records.requests must be a non-empty list')
  reqs.forEach((r: Obj, i: number) => {
    const extra = Object.keys(r).filter((k) => !REQUEST_KEYS.has(k))
    if (extra.length) throw new Bad(`request ${i}: unknown key(s) ${extra.join(', ')}`)
    if (typeof r['method'] !== 'string' || typeof r['path'] !== 'string') throw new Bad(`request ${i}: method and path are required`)
    if ('form' in r && 'body' in r) throw new Bad(`request ${i}: give form or body, not both`)
  })
  return inp
}

export function pairs(v: unknown, what: string): [string, string][] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) throw new Bad(`${what}[${i}] must be [name, value]`)
    return [String(p[0]), String(p[1])]
  })
  if (typeof v === 'object') return Object.entries(v as Obj).map(([k, x]) => [k, String(x)])
  throw new Bad(`${what} must be a list of pairs or an object`)
}

const encode = (ps: [string, string][]) => new URLSearchParams(ps).toString()

export function target(r: Obj): string {
  const q = pairs(r['query'], 'query')
  return q.length ? r['path'] + (String(r['path']).includes('?') ? '&' : '?') + encode(q) : r['path']
}

/** Texts inside elements carrying the class, whitespace collapsed, empty ones dropped. */
export function messagesOf(screens: Screen[], cls: string | undefined): string[] {
  if (!cls) return []
  const out: string[] = []
  const re = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^"']*["'][^>]*>([\\s\\S]*?)</\\1\\s*>`, 'g')
  screens.forEach((s, i) => {
    if (s['body_encoding'] !== 'utf-8' || typeof s['body'] !== 'string') return
    for (const m of s['body'].matchAll(re)) {
      for (const piece of m[2]!.split(/<br\s*\/?>|<\/?(?:p|div)\b[^>]*>/i)) {
        const t = piece.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
        if (t) out.push(`${i}:${t}`)
      }
    }
  })
  return out
}

function bodyValue(b: Buffer): [string, string] {
  const s = b.toString('utf8')
  return Buffer.from(s, 'utf8').equals(b) ? [s, 'utf-8'] : [b.toString('base64'), 'base64']
}

type Resp = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer } | { timeout: true }

function send(port: number, method: string, path: string, headers: Record<string, string>, body: Buffer | null, timeoutS: number): Promise<Resp> {
  return new Promise((res, rej) => {
    const rq = request({ host: '127.0.0.1', port, method, path, headers, agent: false, setHost: false }, (rs) => {
      const chunks: Buffer[] = []
      rs.on('data', (c: Buffer) => chunks.push(c))
      rs.on('end', () => { clearTimeout(t); res({ status: rs.statusCode ?? 0, headers: rs.headers, body: Buffer.concat(chunks) }) })
      rs.on('error', rej)
    })
    const t = setTimeout(() => { rq.destroy(); res({ timeout: true }) }, timeoutS * 1000)
    rq.on('error', (e) => { clearTimeout(t); rej(e) })
    if (body) rq.write(body)
    rq.end()
  })
}

function updateCookies(jar: Map<string, string>, h: Record<string, string | string[] | undefined>): void {
  const sc = h['set-cookie']
  for (const c of Array.isArray(sc) ? sc : sc ? [sc] : []) {
    const first = c.split(';', 1)[0]!
    const i = first.indexOf('=')
    if (i < 0) continue
    const name = first.slice(0, i).trim()
    if (/max-age\s*=\s*0(\s*;|\s*$)/i.test(c)) jar.delete(name)
    else jar.set(name, first.slice(i + 1))
  }
}

const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
const hasHeader = (h: Record<string, string>, n: string) => Object.keys(h).some((k) => k.toLowerCase() === n)
const one = (v: string | string[] | undefined) => (v === undefined ? null : Array.isArray(v) ? v.join(', ') : v)

export async function replay(port: number, reqs: Obj[], jar: Map<string, string>, host: string, timeoutS: number): Promise<{ screens: Screen[]; abend: string | null }> {
  const screens: Screen[] = []
  for (const [i, r] of reqs.entries()) {
    const method = String(r['method']).toUpperCase()
    let headers: Record<string, string> = {}
    let body: Buffer | null = null
    if ('form' in r) { body = Buffer.from(encode(pairs(r['form'], `request ${i} form`)), 'utf8'); headers['Content-Type'] = 'application/x-www-form-urlencoded' }
    else if ('body' in r) body = Buffer.from(String(r['body']), 'utf8')
    for (const [k, v] of pairs(r['headers'], `request ${i} headers`)) {
      headers = Object.fromEntries(Object.entries(headers).filter(([hk]) => hk.toLowerCase() !== k.toLowerCase()))
      headers[k] = v
    }
    if (!hasHeader(headers, 'host')) headers = { Host: host, ...headers }
    if (jar.size && !hasHeader(headers, 'cookie')) headers['Cookie'] = cookieHeader(jar)
    if (body) headers['Content-Length'] = String(body.length)
    const follow = Boolean(r['follow_redirects'])
    const chain: Obj[] = []
    let resp: Resp
    try {
      resp = await send(port, method, target(r), headers, body, timeoutS)
      for (let hops = 0; follow && 'status' in resp && [301, 302, 303, 307, 308].includes(resp.status) && resp.headers['location'] && hops < 10; hops++) {
        updateCookies(jar, resp.headers)
        const loc = new URL(String(one(resp.headers['location'])), `http://${headers['Host'] ?? host}`)
        chain.push({ status: String(resp.status), location: one(resp.headers['location']) })
        if (![headers['Host'] ?? host, `127.0.0.1:${port}`, `localhost:${port}`].includes(loc.host)) break
        const keep = [307, 308].includes(resp.status)
        const h2: Record<string, string> = Object.fromEntries(Object.entries(headers).filter(([k]) => !['content-type', 'content-length', 'cookie'].includes(k.toLowerCase())))
        if (jar.size) h2['Cookie'] = cookieHeader(jar)
        if (keep && body) { h2['Content-Type'] = headers['Content-Type'] ?? 'application/octet-stream'; h2['Content-Length'] = String(body.length) }
        resp = await send(port, keep ? method : 'GET', loc.pathname + loc.search, h2, keep ? body : null, timeoutS)
      }
    } catch (e) {
      return { screens, abend: `request[${i}]:connection_error:${(e as NodeJS.ErrnoException).code ?? (e as Error).name}` }
    }
    if (!('status' in resp)) { screens.push({ status: null, timeout: true, ...(follow ? { redirect_chain: chain } : {}) }); continue }
    updateCookies(jar, resp.headers)
    const [b, enc] = bodyValue(resp.body)
    const hdrs: Obj = { 'content-type': one(resp.headers['content-type']), location: one(resp.headers['location']) }
    for (const h of (r['record_headers'] ?? []) as string[]) hdrs[h.toLowerCase()] = one(resp.headers[h.toLowerCase()])
    screens.push({ status: String(resp.status), headers: hdrs, body: b, body_encoding: enc, ...(follow ? { redirect_chain: chain } : {}) })
  }
  return { screens, abend: null }
}

const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer()
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)) })
  s.on('error', rej)
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const canConnect = (port: number) => new Promise<boolean>((res) => {
  const c = createConnection({ host: '127.0.0.1', port })
  c.on('connect', () => { c.destroy(); res(true) })
  c.on('error', () => res(false))
})

function exited(p: ChildProcess): Promise<number> {
  return new Promise((res) => {
    if (p.exitCode !== null) return res(p.exitCode)
    if (p.signalCode) return res(128 + (signalNo(p.signalCode) ?? 0))
    p.once('exit', (code, sig) => res(code ?? 128 + (signalNo(sig) ?? 0)))
  })
}
const SIGNALS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }
const signalNo = (s: string | null) => (s ? SIGNALS[s] : undefined)

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const utcDate = () => new Date().toISOString().slice(0, 10)

export async function run(o: Obj): Promise<Obj> {
  const inp = loadInput(o.case)
  const notes: string[] = []
  const clock: string | null = inp['clock'] ?? null
  if (clock !== null && !/^\d{4}-\d{2}-\d{2}/.test(clock)) throw new Bad('clock must be null or an ISO date-time')
  if (clock && !o['clock-wrap'] && utcDate() !== clock.slice(0, 10)) {
    throw new NotRun(`clock ${clock} needs a --clock-wrap, or a run on ${clock.slice(0, 10)} UTC`)
  }
  const workdir = o.workdir ? resolve(o.workdir) : mkdtempSync(join(tmpdir(), 'rig-http-'))
  mkdirSync(join(workdir, 'app'), { recursive: true })
  const port = await freePort()
  // {clock_datetime}: "YYYY-MM-DD HH:MM:SS" in UTC, the form libfaketime's FAKETIME="@..." takes.
  const clockDatetime = clock ? new Date(clock).toISOString().slice(0, 19).replace('T', ' ') : ''
  const fill = (s: string) => s.replaceAll('{port}', String(port)).replaceAll('{workdir}', workdir)
    .replaceAll('{clock_datetime}', clockDatetime).replaceAll('{clock}', clock ?? '')
  const params = Object.entries((inp['params'] ?? {}) as Obj).map(([k, v]) => shq(`--${k}=${v}`)).join(' ')
  let cmd = fill(o.start) + (params ? ' ' + params : '')
  // The wrap is a prefix inside the shell, right before the start command: macOS drops DYLD_* variables when it starts
  // the protected /bin/sh, so a wrapper around `sh -c` never reaches the JVM (owner's libfaketime spike, 2026-11-06).
  if (clock && o['clock-wrap']) { cmd = `${fill(o['clock-wrap'])} ${cmd}`; notes.push(`clock held by --clock-wrap at ${clock}`) }
  else if (clock) notes.push(`clock ${clock}: held only by running on that UTC day`)
  else notes.push('input.clock is null: the case asserts it is date-insensitive; the app ran on the host clock')
  const env: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(workdir, 'app'), TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
  }
  for (const kv of o.env as string[]) { const i = kv.indexOf('='); if (i < 1) throw new Bad(`--env ${kv}: NAME=VALUE`); env[kv.slice(0, i)] = kv.slice(i + 1) }

  const app = spawn('sh', ['-c', cmd], { cwd: join(workdir, 'app'), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const log: Buffer[] = []
  app.stdout!.on('data', (c) => log.push(c)); app.stderr!.on('data', (c) => log.push(c))
  const done = exited(app)
  let abend: string | null = null
  let screens: Screen[] = []
  let elapsedMs: number | null = null
  const deadline = Date.now() + Number(o['startup-timeout']) * 1000
  let up = false
  while (Date.now() < deadline) {
    if (app.exitCode !== null || app.signalCode) break
    if (await canConnect(port)) { up = true; break }
    await sleep(200)
  }
  if (!up) abend = app.exitCode !== null || app.signalCode ? `startup_exit:${await done}` : 'startup_timeout'
  else {
    const jar = new Map<string, string>(Object.entries((inp['session']?.['cookies'] ?? {}) as Record<string, string>))
    const t0 = performance.now()
    const r = await replay(port, inp['records']['requests'], jar, o.host, Number(o['request-timeout']))
    elapsedMs = Math.round(performance.now() - t0) // the requests only: start-up and shutdown are not latency
    screens = r.screens
    abend = r.abend
  }
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-app.pid!, sig) } catch { /* already gone */ } }
  kill('SIGTERM')
  // The shutdown allowance is cleared as soon as the app exits: a pending timer kept node alive 60 s after every run
  // (ENG-C core 2: 63 s per case instead of about 3.5 s).
  let allowance: NodeJS.Timeout | undefined
  const rc = await Promise.race([done, new Promise<null>((r) => { allowance = setTimeout(() => r(null), 60_000) })])
  clearTimeout(allowance)
  let returnCode: number
  if (rc === null) { kill('SIGKILL'); returnCode = await done; abend = abend ?? 'shutdown_timeout' } else returnCode = rc
  writeFileSync(join(workdir, 'app.log'), Buffer.concat(log))

  if (clock && !o['clock-wrap'] && utcDate() !== clock.slice(0, 10)) throw new Untrusted('the UTC date changed during the run')
  let stores: Obj = {}
  if (o['stores-cmd']) {
    const r = spawnSync('sh', ['-c', fill(o['stores-cmd'])], { cwd: workdir, env, encoding: 'utf8', maxBuffer: 1 << 28 })
    if (r.status !== 0) throw new Untrusted(`stores command exited ${r.status}: ${(r.stderr ?? '').slice(0, 300)}`)
    try { stores = JSON.parse(r.stdout) } catch { throw new Untrusted('stores command did not print JSON') }
    for (const [k, v] of Object.entries(stores)) if (!Array.isArray((v as Obj)?.['records'])) throw new Untrusted(`store ${k} has no records list`)
  }
  for (const s of screens) if (typeof s['body'] === 'string' && s['body'].includes(String(port))) { notes.push(`a screen contains the server port ${port}: it varies run to run`); break }
  if (!clock && screens.some((s) => typeof s['body'] === 'string' && s['body'].includes(utcDate()))) notes.push("a screen contains today's date but the case has clock null")
  // The clock was applied (by the wrap, or by running on that UTC day, checked above), so its calendar events count.
  return { screens, messages: messagesOf(screens, o['message-class']), stores, return_code: returnCode, abend, notes, workdir,
           ...(elapsedMs !== null ? { elapsed_ms: elapsedMs } : {}),
           ...(clock ? { clock_applied: clock } : {}) }
}

export async function main(argv: string[]): Promise<number> {
  const { values: a, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      case: { type: 'string' }, out: { type: 'string' }, start: { type: 'string' }, env: { type: 'string', multiple: true, default: [] },
      'stores-cmd': { type: 'string' }, 'message-class': { type: 'string' }, 'clock-wrap': { type: 'string' },
      'startup-timeout': { type: 'string', default: '180' }, 'request-timeout': { type: 'string', default: '30' },
      host: { type: 'string', default: 'localhost:8080' }, workdir: { type: 'string' }, help: { type: 'boolean' },
    },
  })
  if (a.help || positionals[0] !== 'run') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); return a.help ? 0 : 2 }
  try {
    if (!a.case || !a.out || !a.start) throw new Bad('--case, --out and --start are required')
    const { workdir, ...obs } = await run(a)
    const tmp = `${a.out}.tmp`
    mkdirSync(dirname(resolve(a.out)), { recursive: true })
    writeFileSync(tmp, JSON.stringify(obs, null, 2) + '\n')
    renameSync(tmp, a.out)
    console.log(JSON.stringify({ out: a.out, screens: obs.screens.length, abend: obs.abend, return_code: obs.return_code, workdir }))
    return 0
  } catch (e) {
    if (e instanceof Bad || (e as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS')) { console.log(JSON.stringify({ error: (e as Error).message })); return 2 }
    if (e instanceof Untrusted) { console.log(JSON.stringify({ untrusted: (e as Error).message })); return 3 }
    if (e instanceof NotRun) { // the same bytes on both sides and every day, so the judge can match the two
      mkdirSync(dirname(resolve(a.out!)), { recursive: true })
      writeFileSync(`${a.out}.tmp`, JSON.stringify({ not_run: (e as Error).message }) + '\n')
      renameSync(`${a.out}.tmp`, a.out!)
      console.log(JSON.stringify({ not_run: (e as Error).message, out: a.out }))
      return 4
    }
    throw e
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => { process.exitCode = c })
