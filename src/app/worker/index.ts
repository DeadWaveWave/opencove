import { resolve } from 'node:path'
import { registerControlSurfaceHttpServer } from '../main/controlSurface/controlSurfaceHttpServer'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../main/controlSurface/remote/resolveControlSurfaceConnectionInfo'
import { createApprovedWorkspaceStoreForPath } from '../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createHeadlessPtyRuntime } from './headlessPtyRuntime'
import { resolveWorkerUserDataDir } from './userData'
import { acquireWorkerSingleInstanceLock } from './singleInstanceLock'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../shared/constants/controlSurface'
import { hydrateCliEnvironmentForAppLaunch } from '../../platform/os/CliEnvironment'
import { hashWebUiPassword } from '../main/controlSurface/http/webUiPassword'
import { isWorkerConnectionAlive } from '../main/worker/workerConnectionHealth'

function readFlagValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  if (index === -1) {
    return null
  }

  const next = argv[index + 1]
  if (!next || next.startsWith('-')) {
    return null
  }

  return next.trim() || null
}

function resolvePort(argv: string[]): number | null {
  const raw = readFlagValue(argv, '--port')
  if (!raw) {
    return null
  }

  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 65_535) {
    throw new Error(`[worker] invalid --port: ${raw}`)
  }

  return value
}

function resolveParentPid(argv: string[]): number | null {
  const raw = readFlagValue(argv, '--parent-pid')
  if (!raw) {
    return null
  }

  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[worker] invalid --parent-pid: ${raw}`)
  }

  return Math.floor(value)
}

function readRepeatedFlagValues(argv: string[], flag: string): string[] {
  const values = []

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) {
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('-')) {
      continue
    }

    const normalized = next.trim()
    if (normalized.length > 0) {
      values.push(normalized)
    }
  }

  return values
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag)
}

function resolveStartedBy(argv: string[]): 'cli' | 'desktop' {
  const raw = readFlagValue(argv, '--started-by')
  if (!raw) {
    return 'cli'
  }

  if (raw === 'cli' || raw === 'desktop') {
    return raw
  }

  throw new Error(`[worker] invalid --started-by: ${raw}`)
}

async function main(): Promise<void> {
  // The worker is frequently launched from GUI contexts (Desktop app, system services) where PATH
  // can be incomplete. Hydrate the environment so git/ssh/etc behave consistently across Desktop,
  // Web UI, and remote/headless installs.
  hydrateCliEnvironmentForAppLaunch(true)

  const argv = process.argv.slice(2)
  const userDataPath = readFlagValue(argv, '--user-data') ?? resolveWorkerUserDataDir()
  const bindHostname = readFlagValue(argv, '--hostname') ?? '127.0.0.1'
  const hostname = readFlagValue(argv, '--advertise-hostname') ?? bindHostname
  const port = resolvePort(argv) ?? 0
  const token = readFlagValue(argv, '--token')
  const webUiPasswordHash = readFlagValue(argv, '--web-ui-password-hash')
  const webUiPassword = readFlagValue(argv, '--web-ui-password')
  if (webUiPasswordHash && webUiPassword) {
    throw new Error('[worker] choose either --web-ui-password or --web-ui-password-hash')
  }
  const resolvedWebUiPasswordHash = webUiPassword
    ? await hashWebUiPassword(webUiPassword)
    : webUiPasswordHash
  const parentPid = resolveParentPid(argv)
  const enableWebUi = !hasFlag(argv, '--disable-web-ui')
  const startedBy = resolveStartedBy(argv)

  const lock = await acquireWorkerSingleInstanceLock(userDataPath)
  if (lock.status === 'existing') {
    const connectionInfo = await resolveControlSurfaceConnectionInfoFromUserData({
      userDataPath,
      fileName: WORKER_CONTROL_SURFACE_CONNECTION_FILE,
      requireLivePid: false,
    })
    if (connectionInfo && (await isWorkerConnectionAlive(connectionInfo))) {
      process.stdout.write(`${JSON.stringify(connectionInfo)}\n`)
      process.stderr.write(
        '[opencove-worker] Local Worker already running for this user data; printed existing connection info.\n',
      )
      process.exit(0)
    }

    process.stderr.write(
      '[opencove-worker] Worker lock exists but its connection is not reachable; launcher must repair stale worker state.\n',
    )
    process.exit(1)
  }

  const approvedWorkspaces = createApprovedWorkspaceStoreForPath(
    resolve(userDataPath, 'approved-workspaces.json'),
  )
  const approvedRoots = readRepeatedFlagValues(argv, '--approve-root')
  await Promise.all(approvedRoots.map(rootPath => approvedWorkspaces.registerRoot(rootPath)))

  const ptyRuntime = createHeadlessPtyRuntime({ userDataPath })

  const server = registerControlSurfaceHttpServer({
    userDataPath,
    hostname,
    bindHostname,
    port,
    token: token ?? undefined,
    approvedWorkspaces,
    ptyRuntime,
    ownsPtyRuntime: true,
    dbPath: resolve(userDataPath, 'opencove.db'),
    enableWebShell: enableWebUi,
    webUiPasswordHash: resolvedWebUiPasswordHash ?? null,
    connectionFileName: WORKER_CONTROL_SURFACE_CONNECTION_FILE,
    connectionStartedBy: startedBy,
  })

  const info = await server.ready
  process.stdout.write(`${JSON.stringify(info)}\n`)
  if (enableWebUi) {
    process.stderr.write(`[opencove-worker] web ui: http://${info.hostname}:${info.port}/\n`)
    process.stderr.write(
      `[opencove-worker] debug shell: http://${info.hostname}:${info.port}/debug/shell\n`,
    )
  } else {
    process.stderr.write('[opencove-worker] web ui: disabled\n')
  }
  if (bindHostname === '0.0.0.0' || bindHostname === '::') {
    process.stderr.write(
      `[opencove-worker] listening on all interfaces. Use your machine's LAN IP to connect from other devices.\n`,
    )
  }
  process.stderr.write(
    `[opencove-worker] auth required (use Authorization: Bearer <token>${resolvedWebUiPasswordHash ? ' or /auth/login password' : ' or a Desktop-issued /auth/claim ticket'})\n`,
  )

  let shutdownRequested = false
  const disposeAndExit = async (code: number): Promise<void> => {
    if (shutdownRequested) {
      return
    }

    shutdownRequested = true

    const forceExitTimer = setTimeout(() => {
      process.exit(code)
    }, 5_000)
    forceExitTimer.unref()

    try {
      await server.dispose()
    } catch {
      // ignore
    }

    try {
      await lock.release()
    } catch {
      // ignore
    } finally {
      clearTimeout(forceExitTimer)
    }

    process.exit(code)
  }

  process.once('SIGINT', () => {
    void disposeAndExit(0)
  })
  process.once('SIGTERM', () => {
    void disposeAndExit(0)
  })

  if (typeof parentPid === 'number') {
    const timer = setInterval(() => {
      try {
        process.kill(parentPid, 0)
      } catch {
        process.stderr.write('[opencove-worker] parent process exited; shutting down.\n')
        void disposeAndExit(0)
      }
    }, 1_000)
    timer.unref()
  }
}

void main().catch(error => {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  process.stderr.write(`[opencove-worker] ${detail}\n`)
  process.exit(1)
})
