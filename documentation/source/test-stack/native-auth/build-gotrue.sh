#!/usr/bin/env bash
# Build the REAL Supabase Auth (GoTrue) server from source.
#
#   bash build-gotrue.sh [version]      # default below
#
# Why from source rather than a container: this environment has a Docker client
# but no daemon, and GoTrue publishes no plain binary this session can reach.
# It is a Go program with no CGO, so `go build` produces a single static binary
# in a few minutes, which is all the stack needs.
#
# TEST TOOLING. The binary is written outside the repository and is never
# deployed, published or pointed at a hosted project.
set -euo pipefail

VERSION="${1:-${GOTRUE_VERSION:-v2.197.0}}"
WORK="${GOTRUE_WORK:-/var/tmp/auth-src}"
OUT="${GOTRUE_BIN:-$WORK/auth}"

if [ -x "$OUT" ]; then
  echo "✔ GoTrue already built at $OUT"
  exit 0
fi

command -v go > /dev/null || { echo "✖ Go toolchain not found" >&2; exit 1; }
echo "── Go $(go version | awk '{print $3}')"

echo "── cloning supabase/auth $VERSION"
rm -rf "$WORK"
git clone --depth 1 --branch "$VERSION" https://github.com/supabase/auth.git "$WORK" 2>&1 | tail -1

echo "── building (a few minutes; the dependency tree is large)"
cd "$WORK"
CGO_ENABLED=0 GOFLAGS=-mod=mod go build -o "$OUT" .

[ -x "$OUT" ] || { echo "✖ build produced no binary" >&2; exit 1; }
echo "✔ built $OUT ($(du -h "$OUT" | cut -f1))"
"$OUT" --help > /dev/null 2>&1 || true
