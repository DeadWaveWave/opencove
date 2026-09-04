#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: smoke-standalone-node-runtime.sh <standalone-asset.tar.gz>" >&2
  exit 2
fi

ASSET_PATH="$1"
SMOKE_ROOT="${OPENCOVE_SMOKE_ROOT:-/tmp/opencove-standalone-smoke}"
INSTALL_ROOT="${SMOKE_ROOT}/install"
BIN_DIR="${SMOKE_ROOT}/bin"
USER_DATA="${SMOKE_ROOT}/user-data"
LAUNCHER_PID=""
WORKER_PID=""

cleanup() {
  if [ -n "${WORKER_PID}" ]; then
    kill "${WORKER_PID}" 2>/dev/null || true
  fi
  if [ -n "${LAUNCHER_PID}" ]; then
    kill "${LAUNCHER_PID}" 2>/dev/null || true
    wait "${LAUNCHER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

export OPENCOVE_STANDALONE_ASSET="${ASSET_PATH}"
export OPENCOVE_INSTALL_ROOT="${INSTALL_ROOT}"
export OPENCOVE_BIN_DIR="${BIN_DIR}"

sh scripts/release-assets/opencove-install.sh

# shellcheck disable=SC1091
. "${INSTALL_ROOT}/current/opencove-runtime.env"
NODE_BIN="${INSTALL_ROOT}/current/${OPENCOVE_NODE_RELATIVE_PATH}"
APP_ROOT="${INSTALL_ROOT}/current/app"
LAUNCHER="${BIN_DIR}/opencove"
CONNECTION_FILE="${USER_DATA}/worker-control-surface.json"

if grep -q 'ELECTRON_RUN_AS_NODE' "${LAUNCHER}"; then
  echo 'standalone node smoke: launcher still enables Electron compatibility mode' >&2
  exit 1
fi

"${NODE_BIN}" -e '
  const { createRequire } = require("node:module")
  const { resolve } = require("node:path")
  const requireFromApp = createRequire(resolve(process.argv[1], "package.json"))
  const Database = requireFromApp("better-sqlite3")
  new Database(":memory:").close()
  const pty = requireFromApp("node-pty")
  if (typeof pty.spawn !== "function") throw new Error("node-pty did not expose spawn")
  process.stdout.write(`standalone node smoke: native ABI ${process.versions.modules}\n`)
' "${APP_ROOT}"

"${LAUNCHER}" worker start --hostname 127.0.0.1 --port 0 --user-data "${USER_DATA}" \
  >"${SMOKE_ROOT}/worker.log" 2>&1 &
LAUNCHER_PID="$!"

attempt=0
while [ "${attempt}" -lt 80 ]; do
  if [ -s "${CONNECTION_FILE}" ]; then
    break
  fi
  if ! kill -0 "${LAUNCHER_PID}" 2>/dev/null; then
    cat "${SMOKE_ROOT}/worker.log" >&2
    echo 'standalone node smoke: worker launcher exited before becoming ready' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.25
done

if [ ! -s "${CONNECTION_FILE}" ]; then
  cat "${SMOKE_ROOT}/worker.log" >&2
  echo 'standalone node smoke: worker did not become ready' >&2
  exit 1
fi

WORKER_PID="$("${NODE_BIN}" -e '
  const fs = require("node:fs")
  const connection = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  const packageJson = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
  if (connection.startedBy !== "cli") throw new Error("worker was not CLI-owned")
  if (connection.appVersion !== packageJson.version) {
    throw new Error(`worker version mismatch: ${connection.appVersion} !== ${packageJson.version}`)
  }
  if (!Number.isInteger(connection.pid) || connection.pid <= 0) throw new Error("invalid worker pid")
  process.stdout.write(String(connection.pid))
' "${CONNECTION_FILE}" "${APP_ROOT}/package.json")"

EXPECTED_NODE="$(readlink -f "${NODE_BIN}")"
CLI_EXECUTABLE="$(readlink -f "/proc/${LAUNCHER_PID}/exe")"
WORKER_EXECUTABLE="$(readlink -f "/proc/${WORKER_PID}/exe")"

if [ "${CLI_EXECUTABLE}" != "${EXPECTED_NODE}" ] || [ "${WORKER_EXECUTABLE}" != "${EXPECTED_NODE}" ]; then
  echo "standalone node smoke: expected Node ${EXPECTED_NODE}" >&2
  echo "standalone node smoke: CLI executable ${CLI_EXECUTABLE}" >&2
  echo "standalone node smoke: worker executable ${WORKER_EXECUTABLE}" >&2
  exit 1
fi

if find "${INSTALL_ROOT}/current/runtime" -type f ! -path '*/runtime/node/bin/node' ! -path '*/runtime/node/LICENSE' | grep -q .; then
  echo 'standalone node smoke: unexpected non-Node runtime file found' >&2
  find "${INSTALL_ROOT}/current/runtime" -type f >&2
  exit 1
fi

echo "standalone node smoke: worker ready pid=${WORKER_PID}"
echo "standalone node smoke: CLI executable ${CLI_EXECUTABLE}"
echo "standalone node smoke: worker executable ${WORKER_EXECUTABLE}"
echo 'standalone node smoke: no Electron executable present'
