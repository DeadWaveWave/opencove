#!/usr/bin/env bash
# Experiment 647-A: interleaved trials of both sides. Usage: run-trials.sh <replica-dir>
# Needs out-baseline and out-spike at the repository root (build-pair.sh). A trial selects its side
# by moving out-<side> to out and back. A red trial is data: its exit code is recorded and the
# script carries on. It fails only on infrastructure errors.
set -uo pipefail

out_dir="${1:?usage: run-trials.sh <replica-dir>}"
rounds="${ROUNDS:-3}"
export CI="${CI:-true}"
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"

for side in baseline spike; do
  if [ ! -f "out-$side/main/index.js" ]; then
    echo "::error::out-$side is missing; run build-pair.sh first"
    exit 1
  fi
done
if [ -e out ]; then
  echo "::error::out exists; a trial needs the sides to be named out-baseline and out-spike"
  exit 1
fi

if [ "$(uname -s)" = Linux ]; then
  display=(xvfb-run -a -s "-screen 0 1600x1200x24")
else
  display=()
fi
# macOS ships bash 3.2: an empty array needs the ${display[@]+...} form under set -u.

current_side=""
restore() {
  if [ -n "$current_side" ] && [ -d out ]; then
    mv out "out-$current_side"
  fi
  current_side=""
}
trap restore EXIT

clean_temp() {
  if [ -n "${RUNNER_TEMP:-}" ]; then rm -rf "${RUNNER_TEMP}/opencove-e2e" || true; fi
  rm -rf /tmp/opencove-e2e || true
  rm -rf /tmp/cove-e2e-user-data-* || true
}

run_drag_commits() {
  local prefix="$1"
  OPENCOVE_E2E_JSON_REPORT="$out_dir/$prefix-drag-commits.json" \
    ${display[@]+"${display[@]}"} pnpm exec playwright test tests/e2e/workspace-canvas.drag-commits.spec.ts \
    >"$out_dir/$prefix-drag-commits.log" 2>&1
  echo $? >"$out_dir/$prefix-drag-commits.exit"
}

run_perf() {
  local prefix="$1"
  mkdir -p "$out_dir/$prefix-perf"
  OPENCOVE_DRAG_REPORT_DIR="$out_dir/$prefix-perf" \
    ${display[@]+"${display[@]}"} pnpm test:perf \
    >"$out_dir/$prefix-perf.log" 2>&1
  echo $? >"$out_dir/$prefix-perf.exit"
  cp test-results/perf/canvas-zoom.json "$out_dir/$prefix-perf/canvas-zoom.json" 2>/dev/null || true
  rm -f "$out_dir/$prefix-perf/drag.trace.json" "$out_dir/$prefix-perf/scene.png"
}

trial() {
  local side="$1" prefix="$2" with_perf="$3"
  mv "out-$side" out
  current_side="$side"
  clean_temp
  echo "== $prefix ($side) drag-commits"
  run_drag_commits "$prefix-$side"
  if [ "$with_perf" = yes ]; then
    clean_temp
    echo "== $prefix ($side) perf"
    run_perf "$prefix-$side"
  fi
  clean_temp
  restore
}

runner_info="$(node -e '
const fs = require("node:fs")
const os = require("node:os")
const { execSync } = require("node:child_process")
const sh = command => { try { return execSync(command, { encoding: "utf8" }).trim() } catch { return null } }
const pairPath = process.argv[1]
const info = {
  uname: sh("uname -a"),
  cpus: os.cpus().length,
  cpuModel: os.cpus()[0]?.model ?? null,
  memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  electron: sh("node -p \"require(\\\"electron/package.json\\\").version\""),
  pair: fs.existsSync(pairPath) ? JSON.parse(fs.readFileSync(pairPath, "utf8")) : null,
}
fs.writeFileSync(process.argv[2], JSON.stringify(info, null, 2) + "\n")
console.log(JSON.stringify(info))
' "$out_dir/pair.json" "$out_dir/runner.json")"
echo "$runner_info"

# Discarded warm-up: file system caches, first-launch costs.
for side in baseline spike; do
  trial "$side" warmup no
done

for round in $(seq 1 "$rounds"); do
  if [ $((round % 2)) -eq 1 ]; then order=(baseline spike); else order=(spike baseline); fi
  for side in "${order[@]}"; do
    trial "$side" "r$round" yes
  done
done

if ! ls "$out_dir"/r*-drag-commits.json >/dev/null 2>&1; then
  echo "::error::no drag-commits report was produced"
  exit 1
fi
