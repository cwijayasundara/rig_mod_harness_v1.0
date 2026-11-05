/**
 * Append-only event log (`.rig/events.jsonl`).
 *
 * The log is the single source of truth for programme state. Each line is one
 * JSON object with a contiguous `seq`. `append` writes and fsyncs before it
 * returns, so an event that was appended survives a kill.
 *
 * A kill can still interrupt a write and leave a partial last line. `open`
 * truncates that torn tail and records a `log_repaired` event. A malformed
 * line anywhere else is corruption, and `open` throws.
 */

import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

export type Event = { seq: number; ts: string; type: string; [field: string]: unknown }

export class LogCorrupt extends Error {
  override name = 'LogCorrupt'
}

const NL = 0x0a

export class EventLog {
  readonly path: string
  #events: Event[] = []
  #fd: number | null = null

  constructor(path: string) {
    this.path = path
  }

  open(): this {
    mkdirSync(dirname(this.path), { recursive: true })
    const fd = openSync(this.path, 'a+')
    const dropped = this.#loadAndRepair(fd)
    this.#fd = fd
    if (dropped > 0) this.append('log_repaired', { dropped_bytes: dropped })
    return this
  }

  close(): void {
    if (this.#fd !== null) closeSync(this.#fd)
    this.#fd = null
  }

  get events(): readonly Event[] {
    return this.#events
  }

  append(type: string, fields: Record<string, unknown> = {}): Event {
    if (this.#fd === null) throw new Error('event log is not open')
    const ev: Event = { seq: this.#events.length + 1, ts: new Date().toISOString(), type, ...fields }
    writeSync(this.#fd, JSON.stringify(ev) + '\n')
    fsyncSync(this.#fd)
    this.#events.push(ev)
    return ev
  }

  #loadAndRepair(fd: number): number {
    let data = readFileSync(this.path)
    let dropped = 0
    if (data.length > 0 && data[data.length - 1] !== NL) {
      const cut = data.lastIndexOf(NL) + 1 // 0 when there is no newline at all
      dropped = data.length - cut
      ftruncateSync(fd, cut)
      fsyncSync(fd)
      data = data.subarray(0, cut)
    }
    this.#events = parseLines(data.toString('utf8'), this.path, true)
    return dropped
  }
}

function parseLines(text: string, path: string, strict: boolean): Event[] {
  const out: Event[] = []
  const lines = text.split('\n')
  lines.pop() // text ends with "\n", or is empty
  lines.forEach((raw, i) => {
    let ev: Event
    try {
      ev = JSON.parse(raw) as Event
    } catch (e) {
      throw new LogCorrupt(`${path}:${i + 1}: ${(e as Error).message}`)
    }
    if (strict && ev.seq !== out.length + 1) {
      throw new LogCorrupt(`${path}:${i + 1}: seq ${ev.seq} != expected ${out.length + 1}`)
    }
    out.push(ev)
  })
  return out
}

/** Read the log without repairing it (for status and inspection). A torn tail is ignored. */
export function readEvents(path: string): Event[] {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const end = text.lastIndexOf('\n') + 1
  return parseLines(text.slice(0, end), path, false)
}
