import type { ControlSurface } from '../controlSurface'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type { AgentProviderRegistry } from '../../../../contexts/agent/application/services/AgentProviderRegistry'
import { captureGeminiSessionDiscoveryCursor } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocatorProviders'
import {
  normalizeAgentSettings,
  resolveAgentExecutablePathOverride,
  resolveAgentModel,
} from '../../../../contexts/settings/domain/agentSettings'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import { resolveSpaceMountContext } from '../../../../contexts/space/application/resolveSpaceMountContext'
import type {
  GetSessionInput,
  GetSessionResult,
  LaunchAgentSessionInput,
  LaunchAgentSessionResult,
} from '../../../../shared/contracts/dto'
import {
  LOCAL_AGENT_SERVER_HOSTNAME,
  reserveLoopbackPort,
  resolveAgentPtySpawnState,
  resolveExecutionContextDto,
  resolveProviderFromSettings,
  resolveSessionLaunchSpawn,
} from './sessionLaunchSupport'
import { resolveSpaceWorkingDirectoryFromStore } from './resolveSpaceWorkingDirectoryFromStore'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { invokeInternalCommand } from './controlSurfaceInternalCommand'
import { registerSessionFinalMessageHandler } from './sessionFinalMessageHandler'
import { registerSessionLaunchAgentInMountHandler } from './sessionLaunchAgentInMountHandler'
import { registerSessionPrepareOrReviveHandler } from './sessionPrepareOrReviveHandler'
import type {
  TerminalRecoverySpawnAdmission,
  TerminalSpawnAdmission,
} from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import { startAgentSessionStateWatcherIfEnabled } from './sessionStateWatcherStart'
import {
  isRecord,
  normalizeLaunchAgentPayload,
  normalizeOptionalString,
} from './sessionLaunchPayloadSupport'
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
  mergeAgentLaunchEnvironment,
  prepareAgentSessionEnvironment,
} from './agentLaunchEnvironment'

function normalizeSessionIdPayload(payload: unknown, operationId: string): GetSessionInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  const sessionIdRaw = payload.sessionId
  if (typeof sessionIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} sessionId.`,
    })
  }

  const sessionId = sessionIdRaw.trim()
  if (sessionId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} sessionId.`,
    })
  }

  return { sessionId }
}

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
    agentProviderRegistry: AgentProviderRegistry
  },
): void {
  const sessions = new Map<string, SessionRecord>()

  controlSurface.register('session.launchAgent', {
    kind: 'command',
    validate: normalizeLaunchAgentPayload,
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
              payload: {
                mountId: mountContext.mount.mountId,
                cwdUri,
                prompt: payload.prompt,
                provider: payload.provider ?? null,
                mode,
                model: payload.model ?? null,
                resumeSessionId,
                env: payload.env ?? null,
                executablePathOverride: payload.executablePathOverride ?? null,
                agentFullAccess: payload.agentFullAccess ?? null,
                cols: payload.cols,
                rows: payload.rows,
              } satisfies LaunchAgentSessionInput & { mountId: string; cwdUri: string | null },
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

      const provider = resolveProviderFromSettings(payload.provider ?? null, agentSettings, mode)
      const model = payload.model ?? resolveAgentModel(agentSettings, provider)
      const executablePathOverride =
        payload.executablePathOverride ??
        resolveAgentExecutablePathOverride(agentSettings, provider)
      const agentFullAccess = payload.agentFullAccess ?? agentSettings.agentFullAccess
      logAgentLaunchInfo('control-surface-resolved-settings', 'Resolved agent launch settings.', {
        provider,
        mode,
        cwd: workingDirectory,
        modelPresent: !!model,
        executablePathOverridePresent: !!executablePathOverride,
        agentFullAccess,
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
        registry: deps.agentProviderRegistry,
        provider,
        cwd: workingDirectory,
        mode,
        model,
        resumeSessionId,
        prompt: payload.prompt,
        agentFullAccess,
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
        requestedEnvironment: payload.env,
        providerEnvironment: managedLaunch.plan.env,
      })

      const resolvedSpawn = await resolveSessionLaunchSpawn({
        workingDirectory,
        defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
        command: launchCommand.command,
        args: launchCommand.args,
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
        return rollbackAgentLaunchArtifacts(error, managedLaunch.artifacts)
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
          throw error
        })
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
        ptyRuntime: deps.ptyRuntime,
        sessionId,
        provider,
        cwd: workingDirectory,
        launchMode: mode,
        resumeSessionId,
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
        resumeSessionId,
        startedAtMs,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
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
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
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
        resumeSessionId,
        effectiveModel: launchCommand.effectiveModel,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
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

  controlSurface.register('session.get', {
    kind: 'query',
    validate: payload => normalizeSessionIdPayload(payload, 'session.get'),
    handle: async (_ctx, payload): Promise<GetSessionResult> => {
      const record = sessions.get(payload.sessionId)
      if (!record) {
        throw createAppError('session.not_found', {
          debugMessage: `session.get: unknown session id: ${payload.sessionId}`,
        })
      }

      const { startedAtMs: _startedAtMs, route: _route, ...publicRecord } = record
      return publicRecord
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerSessionFinalMessageHandler(controlSurface, { sessions, topology: deps.topology })

  controlSurface.register('session.kill', {
    kind: 'command',
    validate: payload => normalizeSessionIdPayload(payload, 'session.kill'),
    handle: async (_ctx, payload): Promise<void> => {
      const record = sessions.get(payload.sessionId) ?? null
      if (!record && !deps.ptyStreamHub.hasSession(payload.sessionId)) {
        throw createAppError('session.not_found', {
          debugMessage: `session.kill: unknown session id: ${payload.sessionId}`,
        })
      }

      deps.ptyRuntime.kill(record?.sessionId ?? payload.sessionId)
    },
    defaultErrorCode: 'terminal.kill_failed',
  })
}
