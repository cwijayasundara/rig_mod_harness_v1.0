# COBOL to Java hazard catalog (§4.3)

Each hazard is a construct whose meaning differs between COBOL and Java, the trigger that finds it in the code, and
the generator that produces inputs to reach it. `/rig:map` records sites under these ids in `hazards.json`. The
oracle-engineer writes one input class per site, `hazard:<id>`. The worker must handle every one, and the judge
requires each class to be reached.

| Hazard | Trigger | What differs | Generator |
|---|---|---|---|
| `rounded` | `ROUNDED` on COMPUTE, ADD, SUBTRACT, MULTIPLY, DIVIDE (also `GIVING ... ROUNDED`) | COBOL rounds half away from zero at the target's scale; Java's `HALF_EVEN` default and double arithmetic do not | Exact results ending in 5 at the first dropped digit, positive and negative |
| `truncation` | Arithmetic into a decimal target without ROUNDED | COBOL truncates toward zero at the target's scale | Results with non-zero digits beyond the target's scale, both signs |
| `high_order_truncation` | A result that can exceed the target's integer digits, with no SIZE ERROR | COBOL drops the high-order digits silently; Java overflows or keeps them | Operands whose result has one more integer digit than the target |
| `size_error` | `ON SIZE ERROR` | The target is unchanged and the branch runs | Results that overflow the target, and division by zero |
| `ebcdic_collation` | SORT keys, `<`/`>` on alphanumerics, START or READ NEXT on character keys, KSDS key order | EBCDIC order (lower < upper < digits) is not ASCII or Unicode order | Keys mixing lower case, upper case, digits, spaces and special characters |
| `syncpoint` | `EXEC CICS SYNCPOINT`/`SYNCPOINT ROLLBACK`; a task or commit scope that writes two or more stores (a CICS task, a batch commit interval) | All writes of the unit of work commit together or not at all; a port that splits them over services or transactions can leave one written and the other not after a failure | Injected: a failure (abend, a refused write, a stopped process) between the first and the last write of the unit of work; the expected outcome is every store as before the unit of work. Replayed traffic almost never holds one, so inject it (`shadow.md`, injected inputs) |
| `redefines` | `REDEFINES` | A write through one view must show through the others | Values written through each view and read through every other, including invalid ones |
| `packed_in_char` | A COMP-3 area redefined as, or moved to, PIC X | The bytes move unchanged and are not converted | Packed values with every sign nibble, read through the character view |
| `invalid_packed` | COMP-3 fields read from input | z/OS abends S0C7 when the field is used in arithmetic; lenient decoders do not | Invalid digit nibbles, invalid sign nibbles, all spaces, all low-values |
| `group_move_filler` | Group-level MOVE, FILLER in output records | The bytes of FILLER are copied | Non-space FILLER in input groups, partial group overlap |
| `month_length` | Date arithmetic, day tables, `FUNCTION INTEGER-OF-DATE` | Month ends, February, leap years | The last day of each month length, 29 February in leap years and not, century years |
| `day_of_week` | `ACCEPT ... FROM DAY-OF-WEEK`, day-name tables | COBOL 1 = Monday; Java `Calendar` 1 = Sunday | Every weekday, as the clock of the case |
| `century_window` | `ACCEPT ... FROM DATE` (YYMMDD), two-digit years | The window pivot decides the century | Years on both sides of the pivot, and the pivot itself |
| `run_mode` | A PARM, SYSIN or control-card field that selects a branch | Each mode is a different path | Every value seen in recordings, plus every value the code tests, plus one it does not |
| `file_status` | Any file status the program tests or prints | Java I/O errors are not file statuses | Each status the program handles, and one it does not (an unexpected status) |
| `abend` | `CALL 'CEE3ABD'`, `STOP RUN` with a return code, `GOBACK` from a nested program | An abend has no return code; a Java exception is not an abend | Every path that reaches the call |
| `display_bytes` | DISPLAY of a group, numeric display fields, edited pictures | DISPLAY prints bytes; zoned signs show as letters | Negative zoned values, every edited picture at its boundaries |
