#!/usr/bin/env bash
# Experiment 647-A: the spike must differ from the baseline only under src/.
# Usage: check-pair.sh <replica-dir>   (writes <replica-dir>/pair.json)
# BASELINE_REF defaults to the pushed baseline branch; MAIN_REF to origin/main.
set -euo pipefail

out_dir="${1:?usage: check-pair.sh <replica-dir>}"
baseline_ref="${BASELINE_REF:-origin/claude/experiment-647-s6-baseline}"
main_ref="${MAIN_REF:-origin/main}"

mkdir -p "$out_dir"
base="$(git rev-parse "$baseline_ref")"
spike="$(git rev-parse HEAD)"

if ! git merge-base --is-ancestor "$base" "$spike"; then
  echo "::error::the baseline $base is not an ancestor of the spike $spike"
  exit 1
fi

outside="$(git diff --name-only "$base" "$spike" -- . ':!src')"
if [ -n "$outside" ]; then
  echo "::error::the spike changes files outside src/:"
  echo "$outside"
  exit 1
fi

main_base="$(git merge-base "$base" "$main_ref")"
echo "base (merge-base of baseline and $main_ref): $main_base"
echo "baseline: $base"
echo "spike:    $spike"
echo "commits in $main_base..$base (expected: the one harness commit):"
git log --oneline "$main_base..$base"
echo "files changed by the spike:"
git diff --name-only "$base" "$spike"

BASE_SHA="$base" SPIKE_SHA="$spike" MAIN_SHA="$main_base" node -e '
const fs = require("node:fs")
fs.writeFileSync(process.argv[1], JSON.stringify({
  base: process.env.MAIN_SHA,
  baseline: process.env.BASE_SHA,
  spike: process.env.SPIKE_SHA,
}, null, 2) + "\n")
' "$out_dir/pair.json"
