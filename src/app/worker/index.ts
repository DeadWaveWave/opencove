import { createPiHookChannel } from '../main/controlSurface/agentHook/piHookChannel'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { registerControlSurfaceHttpServer } from '../main/controlSurface/controlSurfaceHttpServer'
import {
  createDesktopManagedControlSurface,
  type DesktopManagedControlSurface,
} from './desktopManagedControlSurface'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../main/controlSurface/remote/resolveControlSurfaceConnectionInfo'
import { createApprovedWorkspaceStoreForPath } from '../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createHeadlessPtyRuntime } from './headlessPtyRuntime'
import { CodexSessionFileDiscovery } from '../../contexts/agent/infrastructure/cli/CodexSessionFileDiscovery'
import { createWorkerTerminalProcessEngine } from '../main/controlSurface/terminal/workerTerminalProcessEngineFactory'
import { resolveWorkerUserDataDir } from './userData'
import { acquireWorkerSingleInstanceLock } from './singleInstanceLock'
import { WORKER_CONTROL_SURFACE_CONNECTION_FILE } from '../../shared/constants/controlSurface'
import { hydrateCliEnvironmentForAppLaunch } from '../../platform/os/CliEnvironment'
import { hashWebUiPassword } from '../../contexts/settings/infrastructure/homeWorker/webUiPassword'
import { isWorkerConnectionAlive } from '../main/worker/workerConnectionHealth'
import { resolveLocalWorkerReusePolicy } from '../../shared/runtime/localWorkerReusePolicy'
import { readHomeWorkerConfigFile } from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import { acquireHomeWorkerConfigLease } from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfigLease'
import { createClaudeHookChannel } from '../main/controlSurface/agentHook/claudeHookChannel'
import { createCodexHookChannel } from '../main/controlSurface/agentHook/codexHookChannel'
import { AgentProviderRegistry } from '../../contexts/agent/application/services/AgentProviderRegistry'
import { createBuiltinAgentProviderContributions } from '../../contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import {
  cleanupLegacyManagedHooksAtStartup,
  reportLegacyManagedHookCleanupFailures,
} from '../../contexts/agent/infrastructure/cleanupLegacyManagedHooksAtStartup'
import { readRepeatedWorkerFlagValues, readWorkerFlagValue } from './workerCliArguments'
import { CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS } from '../../shared/runtime/controlSurfaceShutdown'
import { getRuntimeBuildIdentity } from '../../shared/runtime/runtimeBuildIdentity'

function resolvePort(argv: string[]): number | null {
  const raw = readWorkerFlagValue(argv, '--port')
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
  const raw = readWorkerFlagValue(argv, '--parent-pid')
  if (!raw) {
    return null
  }

  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[worker] invalid --parent-pid: ${raw}`)
  }

  return Math.floor(value)
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag)
}

function resolveStartedBy(argv: string[]): 'cli' | 'desktop' {
  const raw = readWorkerFlagValue(argv, '--started-by')
  if (!raw) {
    return 'cli'
  }

  if (raw === 'cli' || raw === 'desktop') {
    return raw
  }

  throw new Error(`[worker] invalid --started-by: ${raw}`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('OpenCove worker: use opencove worker start --help for CLI usage.\n')
    return
  }
  // The worker is frequently launched from GUI contexts (Desktop app, system services) where PATH
  // can be incomplete. Hydrate the environment so git/ssh/etc behave consistently across Desktop,
  // Web UI, and remote/headless installs.
  await hydrateCliEnvironmentForAppLaunch(true)
  reportLegacyManagedHookCleanupFailures(await cleanupLegacyManagedHooksAtStartup(homedir()))

  const userDataPath = readWorkerFlagValue(argv, '--user-data') ?? resolveWorkerUserDataDir()
  const bindHostname = readWorkerFlagValue(argv, '--hostname') ?? '127.0.0.1'
  const hostname = readWorkerFlagValue(argv, '--advertise-hostname') ?? bindHostname
  const port = resolvePort(argv) ?? 0
  const token = readWorkerFlagValue(argv, '--token')
  const webUiPasswordHash = readWorkerFlagValue(argv, '--web-ui-password-hash')
  const webUiPassword = readWorkerFlagValue(argv, '--web-ui-password')
  if (webUiPasswordHash && webUiPassword) {
    throw new Error('[worker] choose either --web-ui-password or --web-ui-password-hash')
  }
  const resolvedWebUiPasswordHash = webUiPassword
    ? await hashWebUiPassword(webUiPassword)
    : webUiPasswordHash
  const parentPid = resolveParentPid(argv)
  const enableWebUi = !hasFlag(argv, '--disable-web-ui')
  const startedBy = resolveStartedBy(argv)
  const appVersion =
    getRuntimeBuildIdentity()?.appVersion ?? readWorkerFlagValue(argv, '--app-version')

  const lock = await acquireWorkerSingleInstanceLock(userDataPath)
  if (lock.status === 'existing') {
    const connectionInfo = await resolveControlSurfaceConnectionInfoFromUserData({
      userDataPath,
      fileName: WORKER_CONTROL_SURFACE_CONNECTION_FILE,
      requireLivePid: false,
    })
    const reusePolicy = connectionInfo
      ? resolveLocalWorkerReusePolicy(connectionInfo, {
          launcherStartedBy: startedBy,
          desktopAppVersion: appVersion,
        })
      : null
    if (
      connectionInfo &&
      reusePolicy?.canReuse === true &&
      (await isWorkerConnectionAlive(connectionInfo, {
        expectedAppVersion: reusePolicy.expectedAppVersion,
      }))
    ) {
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
  const approvedRoots = readRepeatedWorkerFlagValues(argv, '--approve-root')
  await Promise.all(approvedRoots.map(rootPath => approvedWorkspaces.registerRoot(rootPath)))

  const forceHookBindFailure =
    process.env.NODE_ENV === 'test' && process.env.OPENCOVE_TEST_CLAUDE_HOOK_BIND_FAILURE === '1'
  const forceHookInstallFailure =
    process.env.NODE_ENV === 'test' && process.env.OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE === '1'
  const claudeHookChannel = createClaudeHookChannel({
    ...(forceHookBindFailure ? { port: -1 } : {}),
    ...(forceHookInstallFailure
      ? {
          prepare: async () => ({ state: 'error' as const, detail: 'test_prepare_failure' }),
        }
      : {}),
  })
  const forceCodexHookBindFailure =
    process.env.NODE_ENV === 'test' && process.env.OPENCOVE_TEST_CODEX_HOOK_BIND_FAILURE === '1'
  const forceCodexHookInstallFailure =
    process.env.NODE_ENV === 'test' && process.env.OPENCOVE_TEST_CODEX_HOOK_INSTALL_FAILURE === '1'
  const codexHookChannel = createCodexHookChannel({
    ...(forceCodexHookBindFailure ? { port: -1 } : {}),
    ...(forceCodexHookInstallFailure
      ? {
          prepare: async () => ({ state: 'error' as const, detail: 'test_prepare_failure' }),
        }
      : {}),
  })
  const piHookChannel = createPiHookChannel()
  const agentHookChannels = {
    pi: piHookChannel,
    'claude-code': claudeHookChannel,
    codex: codexHookChannel,
  }
  const codexSessionDiscovery = new CodexSessionFileDiscovery()
  const agentProviderRegistry = new AgentProviderRegistry(
    // Share the launch identity owner with the file state watcher.
    createBuiltinAgentProviderContributions({
      appVersion,
      channels: agentHookChannels,
      codexSessionDiscovery,
      runtimeExecutable: process.execPath,
      runtimePlatform: process.platform,
    }),
  )
  const ptyRuntime = createHeadlessPtyRuntime({
    sessionDiscovery: codexSessionDiscovery,
    processEngine: createWorkerTerminalProcessEngine({ userDataPath }),
  })

  const serverOptions = {
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
    appVersion,
    deploymentId: readWorkerFlagValue(argv, '--deployment-id'),
    strictPersistence: hasFlag(argv, '--managed-runtime'),
    activationId: readWorkerFlagValue(argv, '--activation-id'),
    requestManagedShutdown: () => {
      void disposeAndExit(0)
    },
    agentHookChannels: [claudeHookChannel, codexHookChannel, piHookChannel],
    agentProviderRegistry,
  }
  const server = await (async () => {
    const configLease =
      startedBy === 'desktop' ? await acquireHomeWorkerConfigLease(userDataPath) : null
    try {
      const candidate =
        startedBy === 'desktop'
          ? createDesktopManagedControlSurface({
              server: serverOptions,
              initialConfig: await readHomeWorkerConfigFile(userDataPath),
            })
          : registerControlSurfaceHttpServer(serverOptions)
      await candidate.ready
      return candidate
    } finally {
      await configLease?.release()
    }
  })()

  const info = await server.ready
  process.stdout.write(`${JSON.stringify(info)}\n`)
  process.stderr.write(
    `[opencove-worker] ${startedBy === 'desktop' ? 'private control' : 'control surface'}: http://${info.hostname}:${info.port}/\n`,
  )
  const desktopWebStatus =
    'getWebAccessStatus' in server
      ? (server as DesktopManagedControlSurface).getWebAccessStatus()
      : null
  const activeWebAddress = desktopWebStatus
    ? desktopWebStatus.state === 'active'
      ? desktopWebStatus.address
      : null
    : enableWebUi
      ? { hostname: info.hostname, bindHostname, port: info.port }
      : null
  if (activeWebAddress) {
    process.stderr.write(
      `[opencove-worker] web ui: http://${activeWebAddress.hostname}:${activeWebAddress.port}/\n`,
    )
    process.stderr.write(
      `[opencove-worker] debug shell: http://${activeWebAddress.hostname}:${activeWebAddress.port}/debug/shell\n`,
    )
  } else if (desktopWebStatus?.state === 'failed' || desktopWebStatus?.state === 'degraded') {
    process.stderr.write(`[opencove-worker] web ui unavailable: ${desktopWebStatus.error}\n`)
  } else {
    process.stderr.write('[opencove-worker] web ui: disabled\n')
  }
  if (activeWebAddress?.bindHostname === '0.0.0.0' || activeWebAddress?.bindHostname === '::') {
    process.stderr.write(
      `[opencove-worker] Web UI listening on all interfaces. Use your machine's LAN IP to connect from other devices.\n`,
    )
  }
  const passwordRequired =
    desktopWebStatus?.state === 'active' || desktopWebStatus?.state === 'degraded'
      ? desktopWebStatus.passwordRequired
      : Boolean(resolvedWebUiPasswordHash)
  process.stderr.write(
    `[opencove-worker] auth required (use Authorization: Bearer <token>${passwordRequired ? ' or /auth/login password' : ' or a Desktop-issued /auth/claim ticket'})\n`,
  )

  let shutdownRequested = false
  const disposeAndExit = async (code: number): Promise<void> => {
    if (shutdownRequested) {
      return
    }

    shutdownRequested = true

    const forceExitTimer = setTimeout(() => {
      process.exit(code)
    }, CONTROL_SURFACE_SHUTDOWN_WATCHDOG_MS)
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
