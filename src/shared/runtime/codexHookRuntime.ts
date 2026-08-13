export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Stop',
] as const

const RUNTIME_COORDINATE_KEYS = [
  'OPENCOVE_AGENT_HOOK_PORT',
  'OPENCOVE_AGENT_HOOK_TOKEN',
  'OPENCOVE_AGENT_HOOK_ENV',
  'OPENCOVE_AGENT_HOOK_VERSION',
  'OPENCOVE_AGENT_HOOK_ENDPOINT',
  'OPENCOVE_PANE_KEY',
  'OPENCOVE_TAB_ID',
  'OPENCOVE_WORKTREE_ID',
  'OPENCOVE_AGENT_LAUNCH_TOKEN',
  'CODEX_HOME',
] as const

const SHELL_SAFE_ENDPOINT_VALUE = /^[A-Za-z0-9._:/-]+$/u

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function buildManagedCodexHookCommand(scriptPath: string): string {
  const quoted = quotePosix(scriptPath)
  return `if [ -f ${quoted} ] && [ -r ${quoted} ] && [ -x ${quoted} ]; then /bin/sh ${quoted}; else { command -p cat 2>/dev/null || cat; } >/dev/null 2>&1 || :; fi`
}

export function buildManagedCodexHookScript(): string {
  return `#!/bin/sh
payload=$({ command -p cat 2>/dev/null || cat; })
if [ -z "$payload" ]; then
  exit 0
fi
load_hook_endpoint() {
  endpoint_path="$1"
  case "$endpoint_path" in
    *.cmd)
      endpoint_cr=$(printf "\\r")
      while IFS= read -r endpoint_line || [ -n "$endpoint_line" ]; do
        endpoint_line=\${endpoint_line%"$endpoint_cr"}
        case "$endpoint_line" in
          "set OPENCOVE_AGENT_HOOK_PORT="*) OPENCOVE_AGENT_HOOK_PORT=\${endpoint_line#*=} ;;
          "set OPENCOVE_AGENT_HOOK_TOKEN="*) OPENCOVE_AGENT_HOOK_TOKEN=\${endpoint_line#*=} ;;
          "set OPENCOVE_AGENT_HOOK_ENV="*) OPENCOVE_AGENT_HOOK_ENV=\${endpoint_line#*=} ;;
          "set OPENCOVE_AGENT_HOOK_VERSION="*) OPENCOVE_AGENT_HOOK_VERSION=\${endpoint_line#*=} ;;
        esac
      done < "$endpoint_path"
      ;;
    *)
      . "$endpoint_path" 2>/dev/null || :
      ;;
  esac
}
if [ -n "$OPENCOVE_AGENT_HOOK_ENDPOINT" ] && [ -r "$OPENCOVE_AGENT_HOOK_ENDPOINT" ]; then
  load_hook_endpoint "$OPENCOVE_AGENT_HOOK_ENDPOINT"
fi
if [ -z "$OPENCOVE_AGENT_HOOK_PORT" ] || [ -z "$OPENCOVE_AGENT_HOOK_TOKEN" ] || [ -z "$OPENCOVE_PANE_KEY" ]; then
  exit 0
fi
post_codex_hook() {
  curl_bin="$1"
  connect_timeout="\${2:-0.5}"
  max_time="\${3:-1.5}"
  printf '%s' "$payload" | "$curl_bin" -sS -X POST "http://127.0.0.1:\${OPENCOVE_AGENT_HOOK_PORT}/hook/codex" \\
    --connect-timeout "$connect_timeout" --max-time "$max_time" \\
    --noproxy "127.0.0.1" \\
    -H "Content-Type: application/x-www-form-urlencoded" \\
    -H "X-OpenCove-Agent-Hook-Token: \${OPENCOVE_AGENT_HOOK_TOKEN}" \\
    --data-urlencode "paneKey=\${OPENCOVE_PANE_KEY}" \\
    --data-urlencode "tabId=\${OPENCOVE_TAB_ID}" \\
    --data-urlencode "worktreeId=\${OPENCOVE_WORKTREE_ID}" \\
    --data-urlencode "launchToken=\${OPENCOVE_AGENT_LAUNCH_TOKEN}" \\
    --data-urlencode "env=\${OPENCOVE_AGENT_HOOK_ENV}" \\
    --data-urlencode "version=\${OPENCOVE_AGENT_HOOK_VERSION}" \\
    --data-urlencode "payload@-"
}
is_wsl_runtime() {
  [ -n "$WSL_DISTRO_NAME" ] && return 0
  grep -qiE "microsoft|wsl" /proc/sys/kernel/osrelease /proc/version 2>/dev/null
}
if post_codex_hook curl >/dev/null 2>&1; then
  exit 0
fi
if is_wsl_runtime; then
  windows_curl=$(command -v curl.exe 2>/dev/null || true)
  if [ -n "$windows_curl" ] && [ -x "$windows_curl" ]; then
    post_codex_hook "$windows_curl" 3 5 >/dev/null 2>&1 || true
  fi
fi
exit 0
`
}

export function serializeAgentHookEndpoint(input: {
  port: number
  token: string
  environment: string
  version: string
  windows?: boolean
}): string {
  const entries = [
    ['OPENCOVE_AGENT_HOOK_PORT', String(input.port)],
    ['OPENCOVE_AGENT_HOOK_TOKEN', input.token],
    ['OPENCOVE_AGENT_HOOK_ENV', input.environment],
    ['OPENCOVE_AGENT_HOOK_VERSION', input.version],
  ] as const
  for (const [, value] of entries) {
    if (!SHELL_SAFE_ENDPOINT_VALUE.test(value)) {
      throw new Error('Agent hook endpoint values must be shell-safe.')
    }
  }
  const prefix = input.windows ? 'set ' : ''
  const newline = input.windows ? '\r\n' : '\n'
  return `${entries.map(([key, value]) => `${prefix}${key}=${value}`).join(newline)}${newline}`
}

export function buildCodexHookPtyEnv(
  baseEnv: NodeJS.ProcessEnv,
  input: {
    endpointPath: string
    paneKey: string
    tabId: string
    worktreeId: string
    codexHome: string
  },
): NodeJS.ProcessEnv {
  const env = cleanAgentHookRuntimeEnv(baseEnv)
  return {
    ...env,
    OPENCOVE_AGENT_HOOK_ENDPOINT: input.endpointPath,
    OPENCOVE_PANE_KEY: input.paneKey,
    OPENCOVE_TAB_ID: input.tabId,
    OPENCOVE_WORKTREE_ID: input.worktreeId,
    CODEX_HOME: input.codexHome,
  }
}

export function cleanAgentHookRuntimeEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...baseEnv }
  for (const key of RUNTIME_COORDINATE_KEYS) {
    delete env[key]
  }
  return env
}
