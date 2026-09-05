import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFlagValue } from './args.mjs'
import {
  createWorkerSpawnEnvironment,
  resolveCliAppVersion,
  resolveCliRuntime,
  resolveWorkerRuntimeForStart,
} from './runtime.mjs'

export async function startWorker(argv) {
  const token = readFlagValue(argv, '--token')
  const runtime = resolveCliRuntime()
  const workerPath = runtime.workerScriptPath
  const appVersion = resolveCliAppVersion(runtime)

  if (!existsSync(workerPath)) {
    process.stderr.write(
      runtime.kind === 'source'
        ? '[opencove] worker is not built. Run `pnpm build` first.\n'
        : `[opencove] worker entry is missing: ${workerPath}\n`,
    )
    process.exit(2)
  }

  if (runtime.kind === 'standalone' && appVersion === null) {
    process.stderr.write(
      '[opencove] standalone runtime package version is missing or invalid; refusing to start an unidentified Worker.\n',
    )
    process.exit(2)
  }

  const workerArgs = []
  const hostname = readFlagValue(argv, '--hostname')
  const advertiseHostname = readFlagValue(argv, '--advertise-hostname')
  const port = readFlagValue(argv, '--port')
  const userData = readFlagValue(argv, '--user-data')
  const webUiPasswordHash = readFlagValue(argv, '--web-ui-password-hash')
  const webUiPassword = readFlagValue(argv, '--web-ui-password')
  const approvedRoots = []

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--approve-root') {
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('-')) {
      continue
    }

    const normalized = next.trim()
    if (normalized.length > 0) {
      approvedRoots.push(normalized)
    }
  }

  if (hostname) {
    workerArgs.push('--hostname', hostname)
  }

  workerArgs.push('--started-by', 'cli')
  if (appVersion !== null) {
    workerArgs.push(`--app-version=${appVersion}`)
  }

  if (advertiseHostname) {
    workerArgs.push('--advertise-hostname', advertiseHostname)
  }

  if (port) {
    workerArgs.push('--port', port)
  }

  if (userData) {
    workerArgs.push('--user-data', userData)
  }

  if (token) {
    workerArgs.push(`--token=${token}`)
  }

  if (webUiPasswordHash) {
    workerArgs.push(`--web-ui-password-hash=${webUiPasswordHash}`)
  }

  if (webUiPassword) {
    workerArgs.push(`--web-ui-password=${webUiPassword}`)
  }

  for (const root of approvedRoots) {
    workerArgs.push('--approve-root', root)
  }

  let workerRuntime
  try {
    workerRuntime = await resolveWorkerRuntimeForStart({ cliRuntime: runtime })
  } catch (error) {
    process.stderr.write(`[opencove] ${error instanceof Error ? error.message : String(error)}.\n`)
    process.exit(2)
  }

  const shouldDisableSandbox =
    process.platform === 'linux' &&
    (process.env.CI === '1' ||
      process.env.CI?.toLowerCase() === 'true' ||
      (typeof process.getuid === 'function' && process.getuid() === 0))

  const child = spawn(workerRuntime.executablePath, [workerPath, ...workerArgs], {
    stdio: 'inherit',
    env: createWorkerSpawnEnvironment(workerRuntime.kind, process.env, {
      disableElectronSandbox: shouldDisableSandbox,
    }),
    windowsHide: true,
  })
  child.on('exit', code => {
    process.exit(code ?? 1)
  })

  return
}
