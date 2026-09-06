#!/bin/sh

set -eu

OWNER="${OPENCOVE_RELEASE_OWNER:-DeadWaveWave}"
REPO="${OPENCOVE_RELEASE_REPO:-opencove}"
RELEASE_BASE_URL="${OPENCOVE_RELEASE_BASE_URL:-https://github.com/${OWNER}/${REPO}/releases/latest/download}"
CHECKSUMS_URL="${RELEASE_BASE_URL}/SHA256SUMS.txt"
INSTALL_ROOT="${OPENCOVE_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/opencove}"
BIN_DIR="${OPENCOVE_BIN_DIR:-$HOME/.local/bin}"
LAUNCHER_PATH="${BIN_DIR}/opencove"
CLI_WRAPPER_MARKER="__OPENCOVE_CLI_WRAPPER__"
CLI_WRAPPER_OWNER_KEY="OPENCOVE_INSTALL_OWNER"
CLI_WRAPPER_OWNER_STANDALONE="standalone"
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

verify_archive_checksum() {
  checksums_path="${TMP_DIR}/SHA256SUMS.txt"
  if [ -n "${OPENCOVE_STANDALONE_CHECKSUMS_FILE:-}" ]; then
    cp "${OPENCOVE_STANDALONE_CHECKSUMS_FILE}" "${checksums_path}"
  else
    curl -fsSL "${CHECKSUMS_URL}" -o "${checksums_path}"
  fi
  expected_checksum="$(awk -v asset="${ASSET_NAME}" '$2 == asset || $2 == "*" asset { print $1; exit }' "${checksums_path}")"
  if [ -z "${expected_checksum}" ]; then
    printf "[opencove-bootstrap:checksum_failed] Checksum for %s not found in %s\n" "${ASSET_NAME}" "${CHECKSUMS_URL}" >&2
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual_checksum="$(sha256sum "${ARCHIVE_PATH}" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    actual_checksum="$(shasum -a 256 "${ARCHIVE_PATH}" | awk '{ print $1 }')"
  elif command -v openssl >/dev/null 2>&1; then
    actual_checksum="$(openssl dgst -sha256 "${ARCHIVE_PATH}" | awk '{ print $NF }')"
  else
    printf "No SHA256 tool is available; refusing to install an unverified archive.\n" >&2
    exit 1
  fi

  if [ "$(printf '%s' "${actual_checksum}" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "${expected_checksum}" | tr '[:upper:]' '[:lower:]')" ]; then
    printf "[opencove-bootstrap:checksum_failed] SHA256 mismatch for %s\n" "${ASSET_NAME}" >&2
    exit 1
  fi
  printf "Verified SHA256 for %s\n" "${ASSET_NAME}"
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

read_launcher_metadata() {
  key="$1"
  if [ ! -f "${LAUNCHER_PATH}" ]; then
    return 1
  fi

  awk -v key="${key}" '
    {
      line = $0
      sub(/^[[:space:]]*#[[:space:]]*/, "", line)
      prefix = key "="
      if (index(line, prefix) == 1) {
        print substr(line, length(prefix) + 1)
        exit
      }
    }
  ' "${LAUNCHER_PATH}"
}

is_standalone_launcher() {
  owner="$(read_launcher_metadata "${CLI_WRAPPER_OWNER_KEY}" || true)"
  if [ "${owner}" = "${CLI_WRAPPER_OWNER_STANDALONE}" ]; then
    return 0
  fi

  if [ -n "${owner}" ]; then
    return 1
  fi

  runtime_bin="$(read_launcher_metadata "OPENCOVE_NODE_BIN" || true)"
  if [ -z "${runtime_bin}" ]; then
    runtime_bin="$(read_launcher_metadata "OPENCOVE_ELECTRON_BIN" || true)"
  fi
  case "${runtime_bin}" in
    "${INSTALL_ROOT}"/*) return 0 ;;
    *) return 1 ;;
  esac
}

uninstall_existing() {
  if [ -f "${LAUNCHER_PATH}" ]; then
    if ! grep -q "${CLI_WRAPPER_MARKER}" "${LAUNCHER_PATH}" 2>/dev/null; then
      printf "Refusing to remove existing non-OpenCove launcher at %s\n" "${LAUNCHER_PATH}" >&2
      exit 1
    fi

    if is_standalone_launcher; then
      rm -f "${LAUNCHER_PATH}"
      printf "Removed OpenCove CLI launcher at %s\n" "${LAUNCHER_PATH}"
    else
      printf "Leaving non-standalone OpenCove launcher at %s\n" "${LAUNCHER_PATH}"
    fi
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
mkdir -p "${INSTALL_ROOT}"
TMP_DIR="$(mktemp -d "${INSTALL_ROOT}/.opencove-install.XXXXXX")"
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
verify_archive_checksum

if ! tar -tzf "${ARCHIVE_PATH}" | awk -v root="${BUNDLE_NAME}" '
  /^\// || /(^|\/)\.\.(\/|$)/ { bad=1 }
  $0 != root && index($0, root "/") != 1 { bad=1 }
  END { exit bad }
'; then
  printf '%s\n' 'Unsafe standalone archive paths.' >&2
  exit 1
fi
tar -xzf "${ARCHIVE_PATH}" -C "${TMP_DIR}"
BUNDLE_DIR="${TMP_DIR}/${BUNDLE_NAME}"
RUNTIME_ENV_PATH="${BUNDLE_DIR}/opencove-runtime.env"

if [ ! -f "${RUNTIME_ENV_PATH}" ]; then
  printf "Standalone runtime manifest not found: %s\n" "${RUNTIME_ENV_PATH}" >&2
  exit 1
fi

NODE_BIN="${BUNDLE_DIR}/runtime/node/bin/node"
BUNDLE_DIR="$("${NODE_BIN}" "${BUNDLE_DIR}/app/src/app/cli/publishRuntime.mjs" "${BUNDLE_DIR}" "${INSTALL_ROOT}/${BUNDLE_NAME}-${actual_checksum}" "${actual_checksum}")"
NODE_BIN="${BUNDLE_DIR}/runtime/node/bin/node"
CLI_SCRIPT="${BUNDLE_DIR}/app/src/app/cli/opencove.mjs"

LAUNCHER_TEMP="${LAUNCHER_PATH}.new.$$"
cat > "${LAUNCHER_TEMP}" <<EOF
#!/bin/sh
# ${CLI_WRAPPER_MARKER}
# OPENCOVE_INSTALL_OWNER=${CLI_WRAPPER_OWNER_STANDALONE}
# OPENCOVE_WRAPPER_KIND=runtime
# OPENCOVE_NODE_BIN=${NODE_BIN}
# OPENCOVE_CLI_SCRIPT=${CLI_SCRIPT}

NODE_BIN=$(quote_sh "${NODE_BIN}")
CLI_SCRIPT=$(quote_sh "${CLI_SCRIPT}")

if [ ! -x "\$NODE_BIN" ]; then
  echo "[opencove] bundled Node runtime not found or not executable: \$NODE_BIN" >&2
  exit 1
fi

if [ ! -f "\$CLI_SCRIPT" ]; then
  echo "[opencove] CLI entry not found: \$CLI_SCRIPT" >&2
  exit 1
fi

exec "\$NODE_BIN" "\$CLI_SCRIPT" "\$@"
EOF

chmod +x "${LAUNCHER_TEMP}"
mv -f "${LAUNCHER_TEMP}" "${LAUNCHER_PATH}"

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
