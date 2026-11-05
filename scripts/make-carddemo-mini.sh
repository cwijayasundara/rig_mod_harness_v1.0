#!/bin/sh
# Rebuild tests/fixtures/carddemo-mini from AWS CardDemo at a pinned commit.
# Files are copied unmodified, except three slices: the CA-7 listing (first
# four jobs), LISTCAT (first entries), and CARDDEMO.CSD (definitions that the
# chosen programs use).
#
#   scripts/make-carddemo-mini.sh [path-to-existing-carddemo-clone]
set -eu
REPO=https://github.com/aws-samples/aws-mainframe-modernization-carddemo.git
COMMIT=59cc6c2fd7ebd7ef7925cad552a01a4b8b6e4d5e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/tests/fixtures/carddemo-mini

SRC=${1:-}
if [ -z "$SRC" ]; then
  SRC=$(mktemp -d)/carddemo
  git clone -q "$REPO" "$SRC"
fi
git -C "$SRC" checkout -q "$COMMIT" 2>/dev/null || [ "$(git -C "$SRC" rev-parse HEAD)" = "$COMMIT" ]

rm -rf "$OUT"
mkdir -p "$OUT"
copy() { for f in "$@"; do mkdir -p "$OUT/$(dirname "$f")"; cp "$SRC/$f" "$OUT/$f"; done; }

copy LICENSE NOTICE
# batch
copy app/jcl/READCUST.jcl app/cbl/CBCUS01C.cbl app/cpy/CVCUS01Y.cpy
copy app/jcl/WAITSTEP.jcl app/cbl/COBSWAIT.cbl
copy app/jcl/INTCALC.jcl app/cbl/CBACT04C.cbl \
     app/cpy/CVTRA01Y.cpy app/cpy/CVACT03Y.cpy app/cpy/CVTRA02Y.cpy app/cpy/CVACT01Y.cpy app/cpy/CVTRA05Y.cpy
copy app/jcl/TRANREPT.jcl app/proc/REPROC.prc app/ctl/REPROCT.ctl         # runs CBTRN03C, deliberately absent
copy app/jcl/INTRDRJ1.JCL app/jcl/INTRDRJ2.JCL app/jcl/FTPJCL.JCL
# cics
copy app/cbl/COSGN00C.cbl app/cbl/COMEN01C.cbl \
     app/cpy/COCOM01Y.cpy app/cpy/COMEN02Y.cpy app/cpy/COTTL01Y.cpy app/cpy/CSDAT01Y.cpy \
     app/cpy/CSMSG01Y.cpy app/cpy/CSUSR01Y.cpy \
     app/cpy-bms/COSGN00.CPY app/cpy-bms/COMEN01.CPY app/bms/COSGN00.bms app/bms/COMEN01.bms
# db2
D=app/app-transaction-type-db2
copy $D/cbl/COBTUPDT.cbl $D/dcl/DCLTRTYP.dcl $D/ddl/TRNTYPE.ddl $D/ddl/XTRNTYPE.ddl $D/jcl/MNTTRDB2.jcl
# ims
I=app/app-authorization-ims-db2-mq
copy $I/cbl/PAUDBUNL.CBL $I/cpy/IMSFUNCS.cpy $I/cpy/CIPAUSMY.cpy $I/cpy/CIPAUDTY.cpy $I/cpy/PAUTBPCB.CPY \
     $I/ims/PAUTBUNL.PSB $I/ims/DBPAUTP0.dbd $I/jcl/UNLDPADB.JCL
# mq (its CMQ* copybooks are IBM-supplied and not in the repo, on purpose)
copy app/app-vsam-mq/cbl/CODATE01.cbl app/app-vsam-mq/csd/CRDDEMOM.csd
# scheduler and catalog
copy app/scheduler/CardDemo.controlm
mkdir -p "$OUT/app/scheduler" "$OUT/app/catlg" "$OUT/app/csd"
sed -n '1,125p' "$SRC/app/scheduler/CardDemo.ca7" > "$OUT/app/scheduler/CardDemo.ca7"
sed -n '1,121p' "$SRC/app/catlg/LISTCAT.txt" > "$OUT/app/catlg/LISTCAT.txt"
# CSD: keep the DEFINE blocks for the chosen transactions, programs, mapsets, files and the JOBS queue
awk 'BEGIN { keep = 0 }
  /^ ?DEFINE / { keep = ($0 ~ /\((CC00|CM00|COSGN00C|COMEN01C|COSGN00|COMEN01|USRSEC|JOBS)\)/) }
  !/^ ?DEFINE / && /^ ?[A-Z*]/ && !/^ +/ { keep = 0 }
  keep' "$SRC/app/csd/CARDDEMO.CSD" > "$OUT/app/csd/CARDDEMO.CSD"

cat > "$OUT/SOURCE.md" <<MD
# carddemo-mini

A small subset of [AWS CardDemo]($REPO) at commit \`$COMMIT\`, used as the M1 test fixture.
Apache-2.0, see LICENSE and NOTICE. Rebuild with \`scripts/make-carddemo-mini.sh\`.

Unmodified copies, except: \`CardDemo.ca7\` (lines 1-125), \`LISTCAT.txt\` (lines 1-121), and
\`CARDDEMO.CSD\` (only the DEFINE blocks for CC00, CM00, COSGN00C, COMEN01C, their mapsets, USRSEC and JOBS).

Deliberate gaps, which the graph must report as unknowns (Rule A): \`CBTRN03C\` (run by TRANREPT),
the IBM copybooks \`DFHAID\`, \`DFHBMSCA\` and \`CMQ*\`, and every program the scheduler names that is not here.
MD
find "$OUT" -type f | wc -l
