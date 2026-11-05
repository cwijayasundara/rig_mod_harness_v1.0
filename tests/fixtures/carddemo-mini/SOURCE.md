# carddemo-mini

A small subset of [AWS CardDemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo.git) at commit `59cc6c2fd7ebd7ef7925cad552a01a4b8b6e4d5e`, used as the M1 test fixture.
Apache-2.0, see LICENSE and NOTICE. Rebuild with `scripts/make-carddemo-mini.sh`.

Unmodified copies, except: `CardDemo.ca7` (lines 1-125), `LISTCAT.txt` (lines 1-121), and
`CARDDEMO.CSD` (only the DEFINE blocks for CC00, CM00, COSGN00C, COMEN01C, their mapsets, USRSEC and JOBS).

Deliberate gaps, which the graph must report as unknowns (Rule A): `CBTRN03C` (run by TRANREPT),
the IBM copybooks `DFHAID`, `DFHBMSCA` and `CMQ*`, and every program the scheduler names that is not here.
