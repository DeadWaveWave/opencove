#!/usr/bin/env bash
# Experiment 647-A: build both sides once on this runner, into out-baseline and out-spike.
# Usage: build-pair.sh <pair.json>   (ends checked out at the spike revision)
set -euo pipefail

pair="${1:?usage: build-pair.sh <pair.json>}"
baseline="$(node -p 'require(require("node:path").resolve(process.argv[1])).baseline' "$pair")"
spike="$(node -p 'require(require("node:path").resolve(process.argv[1])).spike' "$pair")"

rm -rf out out-baseline out-spike
for side in baseline spike; do
  rev="$baseline"
  if [ "$side" = spike ]; then rev="$spike"; fi
  git switch --detach "$rev"
  pnpm build
  test -f out/main/index.js
  echo "$rev" > out/BUILD_REVISION
  mv out "out-$side"
  echo "built $side at $rev"
done
# The spike is built last, so the checkout ends where the pair check ran.
git switch --detach "$spike"
