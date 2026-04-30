#!/bin/sh

set -eu

OWNER="${OPENCOVE_RELEASE_OWNER:-DeadWaveWave}"
REPO="${OPENCOVE_RELEASE_REPO:-opencove}"
RELEASE_BASE_URL="${OPENCOVE_RELEASE_BASE_URL:-https://github.com/${OWNER}/${REPO}/releases/latest/download}"
INSTALL_ROOT="${OPENCOVE_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/opencove}"
BIN_DIR="${OPENCOVE_BIN_DIR:-$HOME/.local/bin}"
LAUNCHER_PATH="${BIN_DIR}/opencove"
CLI_WRAPPER_MARKER="__OPENCOVE_CLI_WRAPPER__"
UNINSTALL=0

case "${1:-}" in
  --uninstall|uninstall)
    UNINSTALL=1
    ;;
  --help|-h)
    printf "Usage: opencove-install.sh [--uninstall]\n"
    exit 0
    ;;
  "")
    ;;
  *)
    printf "Unknown option: %s\n" "$1" >&2
    exit 2
    ;;
esac

cleanup() {
  if [ -n "${TMP_DIR:-}" ] && [ -d "${TMP_DIR}" ]; then
    rm -rf "${TMP_DIR}"
  fi
}

trap cleanup EXIT INT TERM

quote_sh() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\"'\"'/g")"
}

detect_platform() {
  case "$(uname -s)" in
    Darwin) printf "macos" ;;
    Linux) printf "linux" ;;
    *)
      printf "Unsupported platform: %s\n" "$(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf "x64" ;;
    arm64|aarch64) printf "arm64" ;;
    *)
      printf "Unsupported architecture: %s\n" "$(uname -m)" >&2
      exit 1
      ;;
  esac
}

read_existing_wrapper() {
  if [ ! -f "${LAUNCHER_PATH}" ]; then
    return 1
  fi

  if ! grep -q "${CLI_WRAPPER_MARKER}" "${LAUNCHER_PATH}" 2>/dev/null; then
    printf "Refusing to overwrite existing non-OpenCove launcher at %s\n" "${LAUNCHER_PATH}" >&2
    exit 1
  fi
}

uninstall_existing() {
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
}

if [ "${UNINSTALL}" = "1" ]; then
  uninstall_existing
  exit 0
fi

PLATFORM="$(detect_platform)"
ARCH="$(detect_arch)"
ASSET_NAME="opencove-server-${PLATFORM}-${ARCH}.tar.gz"
ASSET_URL="${RELEASE_BASE_URL}/${ASSET_NAME}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opencove-install.XXXXXX")"
ARCHIVE_PATH="${TMP_DIR}/${ASSET_NAME}"
BUNDLE_NAME="${ASSET_NAME%.tar.gz}"
BUNDLE_DIR="${INSTALL_ROOT}/${BUNDLE_NAME}"
CURRENT_LINK="${INSTALL_ROOT}/current"
RUNTIME_ENV_PATH="${BUNDLE_DIR}/opencove-runtime.env"

mkdir -p "${INSTALL_ROOT}" "${BIN_DIR}"
read_existing_wrapper || true

if [ -n "${OPENCOVE_STANDALONE_ASSET:-}" ]; then
  printf "Using local standalone asset %s\n" "${OPENCOVE_STANDALONE_ASSET}"
  cp "${OPENCOVE_STANDALONE_ASSET}" "${ARCHIVE_PATH}"
else
  printf "Downloading %s\n" "${ASSET_URL}"
  curl -fsSL "${ASSET_URL}" -o "${ARCHIVE_PATH}"
fi

rm -rf "${BUNDLE_DIR}"
tar -xzf "${ARCHIVE_PATH}" -C "${INSTALL_ROOT}"

if [ ! -f "${RUNTIME_ENV_PATH}" ]; then
  printf "Standalone runtime manifest not found: %s\n" "${RUNTIME_ENV_PATH}" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "${RUNTIME_ENV_PATH}"

if [ -z "${OPENCOVE_EXECUTABLE_RELATIVE_PATH:-}" ] || [ -z "${OPENCOVE_CLI_SCRIPT_RELATIVE_PATH:-}" ]; then
  printf "Standalone runtime manifest is incomplete.\n" >&2
  exit 1
fi

ln -sfn "${BUNDLE_DIR}" "${CURRENT_LINK}"

ELECTRON_BIN="${CURRENT_LINK}/${OPENCOVE_EXECUTABLE_RELATIVE_PATH}"
CLI_SCRIPT="${CURRENT_LINK}/${OPENCOVE_CLI_SCRIPT_RELATIVE_PATH}"

cat > "${LAUNCHER_PATH}" <<EOF
#!/bin/sh
# ${CLI_WRAPPER_MARKER}
# OPENCOVE_WRAPPER_KIND=runtime
# OPENCOVE_ELECTRON_BIN=${ELECTRON_BIN}
# OPENCOVE_CLI_SCRIPT=${CLI_SCRIPT}

ELECTRON_BIN=$(quote_sh "${ELECTRON_BIN}")
CLI_SCRIPT=$(quote_sh "${CLI_SCRIPT}")

if [ ! -x "\$ELECTRON_BIN" ]; then
  echo "[opencove] OpenCove executable not found: \$ELECTRON_BIN" >&2
  exit 1
fi

case "\$CLI_SCRIPT" in
  *.asar/*) ;;
  *)
    if [ ! -f "\$CLI_SCRIPT" ]; then
      echo "[opencove] CLI entry not found: \$CLI_SCRIPT" >&2
      exit 1
    fi
    ;;
esac

ELECTRON_RUN_AS_NODE=1 "\$ELECTRON_BIN" "\$CLI_SCRIPT" "\$@"
EOF

chmod +x "${LAUNCHER_PATH}"

printf "Installed OpenCove CLI at %s\n" "${LAUNCHER_PATH}"
printf "Runtime bundle: %s\n" "${BUNDLE_DIR}"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    printf "Add %s to PATH if needed:\n" "${BIN_DIR}"
    printf "  export PATH=%s:\$PATH\n" "${BIN_DIR}"
    ;;
esac

printf "Smoke check:\n"
printf "  opencove worker start --help\n"
