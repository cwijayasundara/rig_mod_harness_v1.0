#!/usr/bin/env node
// Rebuild tests/fixtures/carddemo-java-mini: the M5 (restructure) fixture.
//
// A small Java monolith: the two CardDemo batch jobs that M3 translated (READCUST/CBCUS01C, INTCALC/CBACT04C),
// copied from the M3 exit run and flattened into one package `carddemo`, with one entry point
// `carddemo.Main <JOB>`. Everything sees everything, which is what a restructure starts from. Seed inputs are the M3
// dev cases (inputs and classes only, never expected outputs: the monolith itself is the reference for R).
//
//   node scripts/make-carddemo-java-mini.ts
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const M3 = join(ROOT, 'tests/runs/2026-11-05-m3-exit')
const OUT = join(ROOT, 'tests/fixtures/carddemo-java-mini')
const PKG = join(OUT, 'src/carddemo')

rmSync(join(OUT, 'src'), { recursive: true, force: true })
rmSync(join(OUT, 'seeds'), { recursive: true, force: true })
mkdirSync(PKG, { recursive: true })

// Class renames: both jobs had a Main; SelfCheck was the worker's test harness, not the system.
const jobs: { dir: string; renames: Record<string, string>; drop: string[] }[] = [
  { dir: 'intcalc', renames: { Main: 'Intcalc' }, drop: [] },
  { dir: 'readcust', renames: { Main: 'Cbcus01c' }, drop: ['SelfCheck'] },
]
for (const j of jobs) {
  const src = join(M3, 'modernized', j.dir, 'src', j.dir)
  for (const f of readdirSync(src).filter((f) => f.endsWith('.java'))) {
    const cls = f.slice(0, -5)
    if (j.drop.includes(cls)) continue
    let text = readFileSync(join(src, f), 'utf8').replace(`package ${j.dir};`, 'package carddemo;')
    for (const [from, to] of Object.entries(j.renames)) text = text.replace(new RegExp(`\\b${from}\\b(?=[\\s(.<])`, 'g'), to)
    writeFileSync(join(PKG, `${j.renames[cls] ?? cls}.java`), text)
  }
}
writeFileSync(join(PKG, 'Main.java'), `package carddemo;

import java.util.Arrays;

/** The one entry point of the CardDemo batch monolith: \`carddemo.Main <JOB>\`, environment per the job's runtime contract. */
public final class Main {
    private Main() { }

    public static void main(String[] args) {
        String job = args.length > 0 ? args[0] : "";
        String[] rest = args.length > 0 ? Arrays.copyOfRange(args, 1, args.length) : args;
        switch (job) {
            case "INTCALC" -> Intcalc.main(rest);
            case "READCUST" -> Cbcus01c.main(rest);
            default -> {
                System.err.println("usage: carddemo.Main INTCALC|READCUST");
                System.exit(2);
            }
        }
    }
}
`)

// Seeds: per job, the dev cases of the M3 set, one per class first, then up to the cap.
const CAP: Record<string, number> = { INTCALC: 14, READCUST: 6 }
for (const job of Object.keys(CAP)) {
  const set = JSON.parse(readFileSync(join(M3, 'oracles/carddemo/sets', `${job}-exec.json`), 'utf8'))
  const cases = (set.dev as string[]).sort().map((id) => JSON.parse(readFileSync(join(M3, 'oracles/carddemo/cases', `${id}.json`), 'utf8')))
  const picked: any[] = []
  const seen = new Set<string>()
  for (const c of cases) if (c.classes.some((k: string) => !seen.has(k))) { picked.push(c); c.classes.forEach((k: string) => seen.add(k)) }
  for (const c of cases) if (picked.length < CAP[job]! && !picked.includes(c)) picked.push(c)
  const dir = join(OUT, 'seeds', job)
  mkdirSync(dir, { recursive: true })
  for (const c of picked) writeFileSync(join(dir, `${c.id.slice(0, 16)}.json`), JSON.stringify({ input: c.input, classes: c.classes }, null, 1) + '\n')
  console.log(`${job}: ${picked.length} seeds, ${seen.size} classes`)
}
cpSync(join(ROOT, 'tests/fixtures/carddemo-mini/LICENSE'), join(OUT, 'LICENSE'))
cpSync(join(ROOT, 'tests/fixtures/carddemo-mini/NOTICE'), join(OUT, 'NOTICE'))
