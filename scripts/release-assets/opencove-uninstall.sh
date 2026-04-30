#!/bin/sh

set -eu

INSTALL_ROOT="${OPENCOVE_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/opencove}"
BIN_DIR="${OPENCOVE_BIN_DIR:-$HOME/.local/bin}"
LAUNCHER_PATH="${BIN_DIR}/opencove"
CLI_WRAPPER_MARKER="__OPENCOVE_CLI_WRAPPER__"

if [ -f "${LAUNCHER_PATH}" ]; then
  if ! grep -q "${CLI_WRAPPER_MARKER}" "${LAUNCHER_PATH}" 2>/dev/null; then
    printf "Refusing to remove existing non-OpenCove launcher at %s\n" "${LAUNCHER_PATH}" >&2
    exit 1
  fi

  rm -f "${LAUNCHER_PATH}"
  printf "Removed OpenCove CLI launcher at %s\n" "${LAUNCHER_PATH}"
fi

if [ -L "${INSTALL_ROOT}/current" ] || [ -e "${INSTALL_ROOT}/current" ]; then
  rm -rf "${INSTALL_ROOT}/current"
fi

for bundle_path in "${INSTALL_ROOT}"/opencove-server-*; do
  if [ -e "${bundle_path}" ]; then
    rm -rf "${bundle_path}"
  fi
done

rmdir "${INSTALL_ROOT}" 2>/dev/null || true
printf "Removed OpenCove standalone runtime bundles from %s\n" "${INSTALL_ROOT}"
