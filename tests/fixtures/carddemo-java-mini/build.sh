#!/bin/sh
# Build the monolith into ./classes (plain javac, Java 21). Pass a source root to build another tree.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${1:-$HERE/src}
OUT=${2:-$HERE/classes}
JAVA_HOME_DIR=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}
rm -rf "$OUT" && mkdir -p "$OUT"
"$JAVA_HOME_DIR/bin/javac" --release 21 -d "$OUT" $(find "$SRC" -name '*.java')
