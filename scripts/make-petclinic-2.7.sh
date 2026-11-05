#!/bin/sh
# Rebuild tests/fixtures/petclinic-2.7 from spring-projects/spring-petclinic at a pinned commit: the last commit on
# the main line with Spring Boot 2.x (2.7.3, Java 1.8), just before "Migrate to Spring Boot 3". The whole tree, as is.
#
#   scripts/make-petclinic-2.7.sh [path-to-existing-clone]
set -eu
REPO=https://github.com/spring-projects/spring-petclinic.git
COMMIT=a5cbb8505a1df3c348c06607933a07fc8c87c222
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/tests/fixtures/petclinic-2.7
SRC=${1:-$ROOT/tests/runs/.cache/spring-petclinic}
[ -d "$SRC/.git" ] || git clone -q "$REPO" "$SRC"
rm -rf "$OUT" && mkdir -p "$OUT"
git -C "$SRC" archive "$COMMIT" | tar -x -C "$OUT"
cat > "$OUT.SOURCE.md" <<MD
# petclinic-2.7

[spring-petclinic]($REPO) at commit \`$COMMIT\` (2022-10-16, Spring Boot 2.7.3, Java 1.8), the last main-line commit
before the migration to Spring Boot 3. Apache-2.0. Rebuild with \`scripts/make-petclinic-2.7.sh\`. The M4 fixture: RIG
uplifts it to Spring Boot 3 and Java 21 and must prove the behaviour unchanged.
MD
find "$OUT" -type f | wc -l
