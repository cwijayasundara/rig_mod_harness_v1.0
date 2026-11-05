# COBOL data to Java types

The Java type holds the value. The adapter keeps the exact bytes. Both must round-trip: reading a record and writing it
back unchanged gives identical bytes, including FILLER and invalid data.

| COBOL | Bytes | Java value | Notes |
|---|---|---|---|
| `PIC X(n)` | n | `String` of exactly n chars (space-padded), or `byte[n]` when the bytes matter | `MOVE` pads on the right with spaces and truncates on the right. `JUSTIFIED RIGHT` reverses that. |
| `PIC A(n)` | n | `String` | as X |
| `PIC 9(p)V9(s)`, display | p+s | `BigDecimal` scale s, unsigned | A non-numeric byte is a data exception (S0C7) when used in arithmetic. Keep the bytes. |
| `PIC S9(p)V9(s)`, display | p+s | `BigDecimal` scale s | The sign is in the zone of the last byte. `SIGN LEADING`/`SEPARATE` change that and add a byte for SEPARATE. |
| `PIC S9(p)V9(s) COMP-3` | ⌊(p+s)/2⌋+1 | `BigDecimal` scale s | Sign nibble C or F positive, D negative. An invalid nibble is S0C7 on z/OS. |
| `PIC S9(1-4) COMP` | 2 | `short`, or `int` with a range check | `TRUNC(STD)`: truncate to the PIC digits. `TRUNC(BIN)`: binary capacity. Cite the compiler option. |
| `PIC S9(5-9) COMP` | 4 | `int` | as above |
| `PIC S9(10-18) COMP` | 8 | `long` | as above |
| `COMP-5` | 2/4/8 | as COMP, but always binary capacity | |
| `COMP-1` / `COMP-2` | 4 / 8 | IBM hexadecimal float, **not** IEEE | Convert explicitly. A tolerance is legal only here. |
| `PIC 9(n)` used as a key | n | `String` | Keep the digits as characters; order is EBCDIC byte order |
| Edited (`Z,ZZ9.99-`, `$`, `CR`, `DB`, `B`, `0`, `/`) | the picture's length | `String`, formatted by a tested formatter per picture | Never `String.format` with locale defaults |
| `OCCURS n` | n × element | `List` of fixed size n, or an array | `OCCURS DEPENDING ON`: the record length varies. The adapter reads the counter first. |
| `REDEFINES` | shared | one `byte[]` area with typed views | See rule 10 in the skill |
| 88-level | — | `boolean isX()` over the parent's value; `setX()` moves the first value | Each value of `VALUE a THRU b` is in the domain |
| `FILLER` | n | kept in the byte area, not as a field | Group MOVEs copy it, so non-space FILLER is observable |

## Records and files

- Fixed-length sequential (`RECFM=F/FB`): exactly `LRECL` bytes per record, no separators.
- Variable (`RECFM=V/VB`): a 4-byte RDW per record on the mainframe. The unload format must say whether RDWs are
  present.
- KSDS: read in key order (EBCDIC), with random access by key. Duplicate keys give status 22, and a record not found
  gives 23. An alternate index through a PATH returns duplicates in insertion order.
- Print files (`LRECL=133`): the first byte is ASA carriage control (`1` new page, `0` double space, `-` triple
  space, space single). It is part of the observable record, or a declared `removed` observable in a delta.
