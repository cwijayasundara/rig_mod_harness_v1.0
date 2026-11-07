# Spring hazard catalog

These add to the COBOL hazards of `cobol-to-java/references/hazards.md`. `/rig:map` cannot find them in the legacy code
(they come from the target framework), so the planner lists every row under the unit's `hazards`, and the
oracle-engineer adds an input class `hazard:<id>` for each one the generator column can reach.

| Hazard | Trigger in the target | What differs | Generator |
|---|---|---|---|
| `S-STDOUT` | Spring banner, start-up info, log lines on stdout | Extra lines in SYSOUT, before or between the program's DISPLAY lines | Any input; the empty input shows it most plainly |
| `S-EXIT` | `SpringApplication.run` returning, Batch `ExitStatus`, an uncaught exception | Exit code 0 or 1 where COBOL gives its RETURN-CODE or an abend | Inputs for every return code and every abend class of the set |
| `S-CHUNK` | Chunk-oriented step, `ItemWriter` buffering, transaction rollback | Records written before an abend are missing (rolled back) or present when COBOL left them otherwise | An abend after the first write: a bad record after good ones |
| `S-READER` | `FlatFileItemReader`, `FixedLengthTokenizer`, line-based reading | Trimmed fields, a newline expected per record, strict length errors, a skipped blank line, an encoding default | Records with leading and trailing spaces, all-space records, a short last record, bytes above 0x7F |
| `S-RESTART` | `JobRepository` that outlives a run; with identical job parameters, "job instance already complete" | Without an incrementer, the second run with identical parameters does nothing. With an incrementer (`RunIdIncrementer`), every launch is a new job instance, so that cannot happen, and the hazard is whatever a second launch inherits from the persistent repository | The same case with `"repeat": 2` (both runners run it twice in one environment, the modern one against one persistent job repository); `class_observables` `["<U>.repeat"]`. What this tests depends on the job: with an incrementer, that a second launch against the persistent repository behaves like the legacy rerun; without one, that identical parameters do. The unit file says which one, and names the incrementer if there is one |
| `S-CONVERT` | Spring conversion, `@Value`, Jackson | Numbers and dates parsed by the framework (locale, leading zeros, sign) | PARM and fields with leading zeros, trailing sign, spaces |
| `S-ORDER` | Bean or step ordering, parallel steps, `@Async` | Output order differs from the JCL step order | Any job with more than one step or output line |
| `S-STARTUP` | Application context start-up | V9: the batch window, per run | Every case; both runners record `elapsed_ms`; `class_observables` `["<U>.timing"]`, and `timing_max_ms` (a per-run budget; a ratio over a few ms of COBOL means little) or `timing_max_ratio` in the requirements |
