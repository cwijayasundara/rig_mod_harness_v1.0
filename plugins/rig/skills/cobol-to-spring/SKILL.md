---
name: cobol-to-spring
description: The RIG bridge for COBOL to Java 21 on Spring Boot 3 (Spring Batch for batch jobs) — the Spring layout of a translated job, what Spring itself changes on the observation surface (stdout, exit codes, chunk commits, restart metadata, start-up time), and the Spring hazard catalog with its generators. It builds on the cobol-to-java bridge, whose type map and COBOL hazards apply unchanged. Load before a worker, fixer or reviewer touches a translate (T) unit whose target is Spring Boot.
---

# COBOL to Spring Boot bridge

Load the `cobol-to-java` skill first and follow every rule in it: the data and arithmetic of a COBOL program map to
Java the same way whatever framework hosts them. This bridge adds what **Spring** changes. The contract is the same
(`${CLAUDE_PLUGIN_ROOT}/docs/PROPOSAL.md` §2): the observation surface is preserved exactly. A framework default that
a consumer can see (a banner on SYSOUT, a different exit code, a commit at the wrong moment) is a defect, not a style.

Read [references/spring-hazards.md](references/spring-hazards.md) before writing the job, its readers and writers,
or its configuration.

## Layout of a translated batch job

- One Spring Boot application per system, one Spring Batch `Job` per JCL job (bean name = the job name), one `Step` per
  JCL step that runs a program. The program's logic is a plain class (no Spring types), called from a `Tasklet`, so the
  `cobol-to-java` rules and tests apply to it unchanged and a later restructure moves it like any class.
- Files go through the repository interface and adapter of `cobol-to-java` rule 1. Use Spring Batch's
  `FlatFileItemReader` only when its behaviour on every record matches the COBOL `READ` (see S-READER); otherwise the
  adapter reads the bytes itself.
- Run one job per process: `java -jar app.jar --spring.batch.job.name=<JOB>` plus the DDs as environment variables,
  exactly the runtime contract of the job. The runner the orchestrator calls is the same command on every case.

## Rules a worker follows

1. **SYSOUT is the program's DISPLAY and nothing else.** No banner, no log line on stdout: `spring.main.banner-mode=off`,
   logging to stderr or a file, `spring.main.log-startup-info=false`. A test checks stdout of a run with no input.
2. **The exit code is the job's return code.** Map it explicitly (`ExitCodeGenerator` from the step's result, and
   `System.exit(SpringApplication.exit(ctx))`). An abend keeps the abend observable of `cobol-to-java` rule 7; a
   Spring `FAILED` status is never an abend by itself.
3. **Commits happen where COBOL's do.** A `WRITE` or `REWRITE` to a file is visible when COBOL makes it visible; a
   chunk-oriented step that buffers writes until commit changes what an abend leaves behind. Use a tasklet with
   immediate writes, or a chunk size of 1 with the same rollback behaviour, and test the abend-after-write case.
4. **No restart state leaks into behaviour.** The `JobRepository` runs in memory (H2, recreated per run), and the same
   job parameters must run again: add a run id parameter, or `RunIdIncrementer`. A second run of the same input must
   give the same observation (the judge reruns cases).
5. **No framework conversion on observable data.** No `@Value`/Spring conversion of PARM or record fields into
   numbers or dates; parse them with the `cobol-to-java` type map. Character set is explicit (`ISO-8859-1` or the
   code page the bridge says), never the platform default.
6. **Time comes from the injected clock** the runtime contract names, never `LocalDate.now()` or Spring's clock.
7. Pin versions in the build (Spring Boot parent, Java release) and list them in the README. Start-up time is real
   V9 cost: report it.
