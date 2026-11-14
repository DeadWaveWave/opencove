import { registerSessionQueryHandlers } from './sessionQueryHandlers'
import {
  admitManagedClaudeLaunch,
  noteManagedClaudeSpawnStarted,
  noteManagedClaudeRuntimeCreated,
} from '../managedClaudeLaunchRuntime'
import { createSessionNodeResolver } from './sessionNodeResolver'
import { registerOperation } from '../registerOperation'
import {
  sessionLaunchAgentOperation,
  sessionCleanupUnreferencedOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/session'
import type { ControlSurface } from '../controlSurface'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { publicTerminalSpawnError } from '../../../../shared/errors/terminalSpawnError'
import { toFileUri } from '../../../../contexts/filesystem/domain'
import type { AgentProviderRegistry } from '../../../../contexts/agent/application/services/AgentProviderRegistry'
import { captureGeminiSessionDiscoveryCursor } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocatorProviders'
import {
  normalizeAgentSettings,
  resolveAgentExecutablePathOverride,
  resolveAgentModel,
} from '../../../../contexts/settings/domain/agentSettings'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import { resolveSpaceMountContext } from '../../../../contexts/space/application/resolveSpaceMountContext'
import type { LaunchAgentSessionResult } from '../../../../shared/contracts/dto'
import {
  LOCAL_AGENT_SERVER_HOSTNAME,
  reserveLoopbackPort,
  resolveAgentPtySpawnState,
  resolveExecutionContextDto,
  resolveSessionLaunchSpawn,
  getPublicTerminalSpawnCommand,
} from './sessionLaunchSupport'
import { resolveSpaceWorkingDirectoryFromStore } from './resolveSpaceWorkingDirectoryFromStore'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { invokeInternalCommand } from './controlSurfaceInternalCommand'
import { registerSessionLaunchAgentInMountHandler } from './sessionLaunchAgentInMountHandler'
import { registerSessionPrepareOrReviveHandler } from './sessionPrepareOrReviveHandler'
import type {
  TerminalRecoverySpawnAdmission,
  TerminalSpawnAdmission,
} from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import { startAgentSessionStateWatcherIfEnabled } from './sessionStateWatcherStart'
import { normalizeOptionalString, toMountedAgentLaunchInput } from './sessionLaunchPayloadSupport'
import type { SessionRecord } from './sessionRecords'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import {
  describeAgentLaunchCommand,
  describeAgentLaunchError,
  logAgentLaunchError,
  logAgentLaunchInfo,
} from '../../diagnostics/agentLaunchRuntimeDiagnostics'
import { registerSessionAgentWatcherHandlers } from './sessionAgentWatcherHandlers'
import { prepareAgentLaunch } from './prepareAgentLaunch'
import { rollbackAgentLaunchArtifacts } from '../../../../contexts/agent/application/services/AgentLaunchArtifactOwner'
import {
  admitLaunchProvider,
  mergeAgentLaunchEnvironment,
  prepareAgentSessionEnvironment,
  resolveAgentLaunchCallerEnv,
} from './agentLaunchEnvironment'

export function registerSessionHandlers(
  controlSurface: ControlSurface,
  deps: {
    userDataPath: string
    approvedWorkspaces: ApprovedWorkspaceStore
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
    topology: WorkerTopologyStore
    restoreTerminalSession?: (input: { nodeId: string; sessionId: string }) => Promise<boolean>
    terminalSpawnAdmission: TerminalSpawnAdmission
    terminalRecoverySpawnAdmission: TerminalRecoverySpawnAdmission
    cleanupUnreferencedSession?: (id: string) => Promise<boolean>
    agentProviderRegistry: AgentProviderRegistry
  },
): void {
  registerOperation(controlSurface, sessionCleanupUnreferencedOperation, {
    defaultErrorCode: 'persistence.unavailable',
    handle: async (ctx, input) => {
      ctx.assertActive?.()
      return { cleaned: (await deps.cleanupUnreferencedSession?.(input.sessionId)) ?? false }
    },
  })
  const sessions = new Map<string, SessionRecord>()
  const resolveNode = createSessionNodeResolver(deps)

  registerOperation(controlSurface, sessionLaunchAgentOperation, {
    handle: async (ctx, payload): Promise<LaunchAgentSessionResult> => {
      const resolvedSpaceId = typeof payload.spaceId === 'string' ? payload.spaceId.trim() : ''
      const resolvedCwd = typeof payload.cwd === 'string' ? payload.cwd.trim() : ''
      const mode = payload.mode === 'resume' ? 'resume' : 'new'
      const resumeSessionId = normalizeOptionalString(payload.resumeSessionId)
      logAgentLaunchInfo(
        'control-surface-received',
        'Control surface received session.launchAgent.',
        {
          provider: payload.provider ?? null,
          mode,
          hasSpaceId: resolvedSpaceId.length > 0,
          cwd: resolvedCwd.length > 0 ? resolvedCwd : null,
          promptLength: payload.prompt.length,
          resumeSessionIdPresent: !!resumeSessionId,
          executablePathOverridePresent: !!payload.executablePathOverride,
          agentFullAccess: payload.agentFullAccess ?? null,
          codexReuseRunningAppServer: payload.codexReuseRunningAppServer ?? null,
          cols: payload.cols ?? null,
          rows: payload.rows ?? null,
        },
      )

      const resolvedSpace = resolvedSpaceId
        ? await resolveSpaceWorkingDirectoryFromStore({
            spaceId: resolvedSpaceId,
            getPersistenceStore: deps.getPersistenceStore,
          })
        : null

      deps.terminalSpawnAdmission.assertSpawnAllowed(
        resolvedSpace?.projectId ?? null,
        ctx.terminalRecoverySpawnScope,
      )

      if (resolvedSpace) {
        const mountContext = resolveSpaceMountContext({
          space: {
            directoryPath: resolvedSpace.directoryPath,
            targetMountId: resolvedSpace.targetMountId,
            boundary: resolvedSpace.boundary,
          },
          workspacePath: resolvedSpace.workspacePath,
          mounts: (await deps.topology.listMounts({ projectId: resolvedSpace.projectId })).mounts,
        })

        if (mountContext.mount) {
          const cwdUri =
            mountContext.workingDirectory.trim().length > 0
              ? toFileUri(mountContext.workingDirectory)
              : null

          const launched = await invokeInternalCommand<LaunchAgentSessionResult>(
            controlSurface,
            ctx,
            {
              id: 'session.launchAgentInMount',
              payload: toMountedAgentLaunchInput(
                payload,
                { mountId: mountContext.mount.mountId, cwdUri },
                ctx.requestAuth,
              ),
            },
          )

          const executionContext = {
            ...launched.executionContext,
            projectId: resolvedSpace.projectId,
            spaceId: resolvedSpaceId,
            scope: mountContext.scope ?? launched.executionContext.scope,
            workingDirectory: mountContext.workingDirectory,
          }
          const record = sessions.get(launched.sessionId)
          if (record) {
            sessions.set(launched.sessionId, {
              ...record,
              executionContext,
            })
          }

          return {
            ...launched,
            executionContext,
          }
        }
      }

      const { workingDirectory, agentSettings } = resolvedSpace
        ? resolvedSpace
        : await (async () => {
            if (resolvedCwd.length === 0) {
              throw createAppError('common.invalid_input', {
                debugMessage: 'session.launchAgent missing cwd.',
              })
            }

            const store = await deps.getPersistenceStore()
            const normalized = normalizePersistedAppState(await store.readAppState())

            return {
              workingDirectory: resolvedCwd,
              agentSettings: normalizeAgentSettings(normalized?.settings),
            }
          })()

      const isApproved = await deps.approvedWorkspaces.isPathApproved(workingDirectory)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'session.launchAgent workingDirectory is outside approved roots',
        })
      }

      const provider = admitLaunchProvider(ctx, payload, agentSettings, mode)
      await admitManagedClaudeLaunch(provider, workingDirectory)
      ctx.assertActive?.()
      const env = resolveAgentLaunchCallerEnv(ctx, agentSettings, provider, payload.env)
      const model = payload.model ?? resolveAgentModel(agentSettings, provider)
      const executablePathOverride =
        payload.executablePathOverride ??
        resolveAgentExecutablePathOverride(agentSettings, provider)
      const agentFullAccess = payload.agentFullAccess ?? agentSettings.agentFullAccess
      const codexReuseRunningAppServer =
        payload.codexReuseRunningAppServer ?? agentSettings.codexReuseRunningAppServer
      logAgentLaunchInfo('control-surface-resolved-settings', 'Resolved agent launch settings.', {
        provider,
        mode,
        cwd: workingDirectory,
        modelPresent: !!model,
        executablePathOverridePresent: !!executablePathOverride,
        agentFullAccess,
        codexReuseRunningAppServer,
        cols: payload.cols ?? 80,
        rows: payload.rows ?? 24,
      })

      const opencodeServer =
        provider === 'opencode'
          ? {
              hostname: LOCAL_AGENT_SERVER_HOSTNAME,
              port: await reserveLoopbackPort(LOCAL_AGENT_SERVER_HOSTNAME),
            }
          : null

      const sessionEnv = await prepareAgentSessionEnvironment({
        provider,
        opencodeServer,
        userDataPath: deps.userDataPath,
      })

      const { launchCommand, managedLaunch, testStub } = await prepareAgentLaunch({
        environment: { ...sessionEnv, ...env },
        registry: deps.agentProviderRegistry,
        profileId: agentSettings.defaultTerminalProfileId,
        provider,
        cwd: workingDirectory,
        mode,
        model,
        resumeSessionId,
        prompt: payload.prompt,
        agentFullAccess,
        codexReuseRunningAppServer,
        opencodeServer,
        executablePathOverride,
      })
      logAgentLaunchInfo(
        'control-surface-command-built',
        'Built agent launch command before spawn resolution.',
        describeAgentLaunchCommand({
          provider,
          mode,
          cwd: workingDirectory,
          command: launchCommand.command,
          args: launchCommand.args,
          executablePathOverride,
        }),
      )

      const startedAtMs = Date.now()
      const startedAt = new Date(startedAtMs).toISOString()

      const mergedEnv = mergeAgentLaunchEnvironment({
        testEnvironment: testStub?.env,
        sessionEnvironment: sessionEnv,
        requestedEnvironment: env,
        providerEnvironment: managedLaunch.plan.env,
      })

      const resolvedSpawn = await resolveSessionLaunchSpawn({
        workingDirectory,
        defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
        command: launchCommand.command,
        args: launchCommand.args,
        fileArguments: launchCommand.fileArguments,
        provider: testStub ? null : provider,
        executablePathOverride,
        ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
      }).catch(error => {
        logAgentLaunchError('control-surface-spawn-resolve-failed', 'Failed to resolve spawn.', {
          provider,
          mode,
          cwd: workingDirectory,
          ...describeAgentLaunchError(error),
        })
        return rollbackAgentLaunchArtifacts(
          publicTerminalSpawnError(error, 'agent.launch_failed'),
          managedLaunch.artifacts,
        )
      })
      logAgentLaunchInfo(
        'control-surface-spawn-resolved',
        'Resolved agent spawn command.',
        describeAgentLaunchCommand({
          provider,
          mode,
          cwd: resolvedSpawn.cwd,
          command: resolvedSpawn.command,
          args: resolvedSpawn.args,
          executablePathOverride,
          env: resolvedSpawn.env,
        }),
      )
      const publicCommand = getPublicTerminalSpawnCommand(resolvedSpawn)
      const geminiDiscoveryCursor =
        provider === 'gemini' && mode === 'new' && !resumeSessionId
          ? await captureGeminiSessionDiscoveryCursor(workingDirectory).catch(() => null)
          : undefined

      const spawnCols = payload.cols ?? 80
      const spawnRows = payload.rows ?? 24
      logAgentLaunchInfo('control-surface-pty-spawn-start', 'Spawning agent PTY session.', {
        provider,
        mode,
        cwd: resolvedSpawn.cwd,
        cols: spawnCols,
        rows: spawnRows,
        command: resolvedSpawn.command,
        argCount: resolvedSpawn.args.length,
      })
      try {
        ctx.assertActive?.()
      } catch (error) {
        return rollbackAgentLaunchArtifacts(error, managedLaunch.artifacts)
      }
      noteManagedClaudeSpawnStarted()
      const { sessionId } = await deps.ptyRuntime
        .spawnSession({
          cwd: resolvedSpawn.cwd,
          cols: spawnCols,
          rows: spawnRows,
          command: resolvedSpawn.command,
          args: resolvedSpawn.args,
          ...resolveAgentPtySpawnState(provider, payload.prompt, mode),
          ...(resolvedSpawn.env ? { env: resolvedSpawn.env } : {}),
          ...(managedLaunch.plan.hookInstallState
            ? { hookInstallState: managedLaunch.plan.hookInstallState }
            : {}),
          hookCoverage: managedLaunch.plan.hookCoverage,
          launchArtifacts: managedLaunch.artifacts,
        })
        .catch(error => {
          logAgentLaunchError('control-surface-pty-spawn-failed', 'PTY spawn failed.', {
            provider,
            mode,
            cwd: resolvedSpawn.cwd,
            cols: spawnCols,
            rows: spawnRows,
            command: resolvedSpawn.command,
            ...describeAgentLaunchError(error),
          })
          throw publicTerminalSpawnError(error, 'agent.launch_failed')
        })
      noteManagedClaudeRuntimeCreated(sessionId)
      managedLaunch.plan.onStarted?.(sessionId)
      logAgentLaunchInfo('control-surface-pty-spawn-succeeded', 'Agent PTY session spawned.', {
        provider,
        mode,
        cwd: resolvedSpawn.cwd,
        sessionId,
        cols: spawnCols,
        rows: spawnRows,
      })

      startAgentSessionStateWatcherIfEnabled({
        hookInstallState: managedLaunch.plan.hookInstallState,
        ptyRuntime: deps.ptyRuntime,
        sessionId,
        provider,
        cwd: workingDirectory,
        launchMode: mode,
        resumeSessionId: managedLaunch.plan.resumeSessionId,
        startedAtMs,
        ...(geminiDiscoveryCursor !== undefined ? { geminiDiscoveryCursor } : {}),
        opencodeBaseUrl: opencodeServer
          ? `http://${opencodeServer.hostname}:${String(opencodeServer.port)}`
          : null,
      })

      const executionContext = resolveExecutionContextDto(workingDirectory, {
        projectId: resolvedSpace?.projectId ?? null,
        spaceId: resolvedSpaceId.length > 0 ? resolvedSpaceId : null,
      })

      const record: SessionRecord = {
        sessionId,
        provider,
        startedAt,
        cwd: workingDirectory,
        prompt: payload.prompt,
        model,
        effectiveModel: launchCommand.effectiveModel,
        executionContext,
        resumeSessionId: managedLaunch.plan.resumeSessionId,
        startedAtMs,
        ...publicCommand,
        launchMode: mode,
        ...(geminiDiscoveryCursor !== undefined ? { geminiDiscoveryCursor } : {}),
        route: { kind: 'local' },
      }

      sessions.set(sessionId, record)
      deps.ptyStreamHub.registerSessionMetadata({
        sessionId,
        kind: 'agent',
        startedAt,
        cwd: workingDirectory,
        ...publicCommand,
        cols: payload.cols ?? 80,
        rows: payload.rows ?? 24,
      })

      return {
        sessionId,
        provider,
        startedAt,
        executionContext,
        profileId: resolvedSpawn.profileId,
        runtimeKind: resolvedSpawn.runtimeKind,
        resumeSessionId: managedLaunch.plan.resumeSessionId,
        effectiveModel: launchCommand.effectiveModel,
        ...publicCommand,
      }
    },
    defaultErrorCode: 'agent.launch_failed',
  })

  registerSessionLaunchAgentInMountHandler(controlSurface, { ...deps, sessions })
  registerSessionAgentWatcherHandlers(controlSurface, deps)
  registerSessionPrepareOrReviveHandler(controlSurface, {
    getPersistenceStore: deps.getPersistenceStore,
    ptyStreamHub: deps.ptyStreamHub,
    ptyRuntime: deps.ptyRuntime,
    restoreTerminalSession: deps.restoreTerminalSession,
    terminalRecoverySpawnAdmission: deps.terminalRecoverySpawnAdmission,
  })

  registerSessionQueryHandlers(controlSurface, deps, sessions, resolveNode)
}
