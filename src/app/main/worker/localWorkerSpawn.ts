export function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

export function resolveForwardedLocalWorkerDiagnosticsEnv(
  envSource: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {}
  const keys = [
    'OPENCOVE_AGENT_LAUNCH_DIAGNOSTICS',
    'OPENCOVE_TERMINAL_DIAGNOSTICS',
    'OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS',
  ]

  for (const key of keys) {
    if (isTruthyEnv(envSource[key])) {
      env[key] = '1'
    }
  }

  return env
}

export function buildLocalWorkerSpawnArgs(options: {
  workerScriptPath: string
  userDataPath: string
  parentPid: number
  bindHostname: string
  advertiseHostname: string
  port: number
  enableWebUi: boolean
  webUiPasswordHash: string | null
  appVersion: string | null
}): string[] {
  const args = [
    options.workerScriptPath,
    '--started-by',
    'desktop',
    '--parent-pid',
    String(options.parentPid),
    '--hostname',
    options.bindHostname,
    '--port',
    String(options.port),
    '--user-data',
    options.userDataPath,
  ]

  if (!options.enableWebUi) {
    args.push('--disable-web-ui')
  }

  if (options.advertiseHostname !== options.bindHostname) {
    args.push('--advertise-hostname', options.advertiseHostname)
  }

  if (options.webUiPasswordHash) {
    args.push('--web-ui-password-hash', options.webUiPasswordHash)
  }

  if (options.appVersion) {
    args.push('--app-version', options.appVersion)
  }

  return args
}
