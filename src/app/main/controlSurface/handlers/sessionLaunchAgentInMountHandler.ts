import type { ControlSurface } from '../controlSurface'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { buildAgentLaunchCommand } from '../../../../contexts/agent/infrastructure/cli/AgentCommandFactory'
import { captureGeminiSessionDiscoveryCursor } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocatorProviders'
import { ensureOpenCodeEmbeddedTuiConfigPath } from '../../../../contexts/agent/infrastructure/opencode/OpenCodeTuiConfig'
import {
  normalizeAgentSettings,
  resolveAgentExecutablePathOverride,
  resolveAgentModel,
} from '../../../../contexts/settings/domain/agentSettings'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type {
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
import { startAgentSessionStateWatcherIfEnabled } from './sessionStateWatcherStart'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { resolveWorkerAgentTestStub } from './sessionAgentTestStub'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { SessionRecord } from './sessionRecords'
import { normalizeOptionalString } from './sessionLaunchPayloadSupport'
import {
  normalizeLaunchAgentInMountPayload,
  resolveOpenCodeEmbeddedXdgStateHome,
} from './sessionLaunchAgentInMountPayload'
import type { TerminalSpawnAdmission } from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import { resolveAdmittedMountAgentLaunch } from './resolveAdmittedMountAgentLaunch'
import {
  describeAgentLaunchCommand,
  describeAgentLaunchError,
  logAgentLaunchError,
  logAgentLaunchInfo,
} from '../../diagnostics/agentLaunchRuntimeDiagnostics'

export function registerSessionLaunchAgentInMountHandler(
  controlSurface: ControlSurface,
  deps: {
    userDataPath: string
    approvedWorkspaces: ApprovedWorkspaceStore
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
    topology: WorkerTopologyStore
    sessions: Map<string, SessionRecord>
    terminalSpawnAdmission: TerminalSpawnAdmission
  },
): void {
  controlSurface.register('session.launchAgentInMount', {
    kind: 'command',
    validate: normalizeLaunchAgentInMountPayload,
    handle: async (ctx, payload): Promise<LaunchAgentSessionResult> => {
      const { target, cwd, mode } = await resolveAdmittedMountAgentLaunch({
        ctx,
        payload,
        topology: deps.topology,
        admission: deps.terminalSpawnAdmission,
      })

      if (target.endpointId !== 'local') {
        logAgentLaunchInfo(
          'control-surface-mount-remote-forward-start',
          'Forwarding agent launch to remote endpoint.',
          {
            mountId: payload.mountId,
            endpointId: target.endpointId,
            targetRootPath: target.rootPath,
            cwd,
            provider: payload.provider ?? null,
            mode,
            executablePathOverridePresent: !!payload.executablePathOverride,
            cols: payload.cols ?? null,
            rows: payload.rows ?? null,
          },
        )
        const endpoint = await deps.topology.resolveRemoteEndpointConnection(target.endpointId)
        if (!endpoint) {
          throw createAppError('worker.unavailable', {
            debugMessage: `Remote endpoint unavailable: ${target.endpointId}`,
          })
        }

        const remoteResult = await (async () => {
          const { result } = await invokeControlSurface(endpoint, {
            kind: 'command',
            id: 'workspace.approveRoot',
            payload: { path: target.rootPath },
          })

          if (!result) {
            throw createAppError('worker.unavailable')
          }

          if (result.ok === false) {
            throw createAppError(result.error)
          }

          const agentLaunchResult = await invokeControlSurface(endpoint, {
            kind: 'command',
            id: 'session.launchAgent',
            payload: {
              cwd,
              prompt: payload.prompt,
              provider: payload.provider ?? null,
              mode,
              model: payload.model ?? null,
              resumeSessionId: payload.resumeSessionId ?? null,
              env: payload.env ?? null,
              executablePathOverride: payload.executablePathOverride ?? null,
              agentFullAccess: payload.agentFullAccess ?? null,
              cols: payload.cols,
              rows: payload.rows,
            } satisfies LaunchAgentSessionInput,
          })

          if (!agentLaunchResult.result) {
            throw createAppError('worker.unavailable')
          }

          if (agentLaunchResult.result.ok === false) {
            logAgentLaunchError(
              'control-surface-mount-remote-launch-failed',
              'Remote endpoint returned an agent launch error.',
              {
                mountId: payload.mountId,
                endpointId: target.endpointId,
                provider: payload.provider ?? null,
                mode,
                errorName: agentLaunchResult.result.error.code,
                errorMessage: agentLaunchResult.result.error.debugMessage ?? null,
                errorStack: null,
              },
            )
            throw createAppError(agentLaunchResult.result.error)
          }

          return agentLaunchResult.result.value as LaunchAgentSessionResult
        })()

        const remoteSessionId = normalizeOptionalString(remoteResult.sessionId)
        if (!remoteSessionId) {
          throw createAppError('worker.unavailable', {
            debugMessage: 'Remote session.launchAgent returned an invalid session id.',
          })
        }

        const homeSessionId = deps.ptyRuntime.registerRemoteSession({
          endpointId: target.endpointId,
          remoteSessionId,
        })
        logAgentLaunchInfo(
          'control-surface-mount-remote-session-registered',
          'Registered remote agent session in home runtime.',
          {
            mountId: payload.mountId,
            endpointId: target.endpointId,
            remoteSessionId,
            homeSessionId,
            provider: remoteResult.provider,
            command: remoteResult.command,
            argCount: remoteResult.args.length,
            cols: payload.cols ?? 80,
            rows: payload.rows ?? 24,
          },
        )

        deps.ptyStreamHub.registerSessionMetadata({
          sessionId: homeSessionId,
          kind: 'agent',
          startedAt: remoteResult.startedAt,
          cwd: remoteResult.executionContext.workingDirectory,
          command: remoteResult.command,
          args: remoteResult.args,
          cols: payload.cols ?? 80,
          rows: payload.rows ?? 24,
        })

        const executionContext = resolveExecutionContextDto(
          remoteResult.executionContext.workingDirectory,
          {
            projectId: remoteResult.executionContext.projectId,
            spaceId: remoteResult.executionContext.spaceId,
            mountId: payload.mountId,
            targetId: target.targetId,
            endpointId: target.endpointId,
            endpointKind: 'remote_worker',
            targetRootPath: target.rootPath,
            targetRootUri: target.rootUri,
            scopeRootPath: target.rootPath,
            scopeRootUri: target.rootUri,
          },
        )

        const startedAtMs = Date.parse(remoteResult.startedAt)

        deps.sessions.set(homeSessionId, {
          sessionId: homeSessionId,
          provider: remoteResult.provider,
          startedAt: remoteResult.startedAt,
          cwd: remoteResult.executionContext.workingDirectory,
          prompt: payload.prompt,
          model: payload.model ?? null,
          effectiveModel: remoteResult.effectiveModel ?? null,
          executionContext,
          resumeSessionId: remoteResult.resumeSessionId ?? null,
          startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
          command: remoteResult.command,
          args: remoteResult.args,
          route: {
            kind: 'remote',
            endpointId: target.endpointId,
            remoteSessionId,
          },
        })

        return {
          ...remoteResult,
          sessionId: homeSessionId,
          executionContext,
        }
      }

      const isApproved = await deps.approvedWorkspaces.isPathApproved(cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'session.launchAgentInMount cwd is outside approved roots',
        })
      }

      const store = await deps.getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const agentSettings = normalizeAgentSettings(normalized?.settings)

      const provider = resolveProviderFromSettings(payload.provider ?? null, agentSettings)
      const model = payload.model ?? resolveAgentModel(agentSettings, provider)
      const executablePathOverride =
        payload.executablePathOverride ??
        resolveAgentExecutablePathOverride(agentSettings, provider)
      const agentFullAccess = payload.agentFullAccess ?? agentSettings.agentFullAccess
      logAgentLaunchInfo(
        'control-surface-mount-local-resolved-settings',
        'Resolved local mount agent launch settings.',
        {
          mountId: payload.mountId,
          provider,
          mode,
          cwd,
          modelPresent: !!model,
          executablePathOverridePresent: !!executablePathOverride,
          agentFullAccess,
          cols: payload.cols ?? 80,
          rows: payload.rows ?? 24,
        },
      )

      const testStub = resolveWorkerAgentTestStub({
        provider,
        cwd,
        mode,
        model,
        resumeSessionId: mode === 'resume' ? (payload.resumeSessionId ?? null) : null,
      })

      const opencodeServer =
        provider === 'opencode'
          ? {
              hostname: LOCAL_AGENT_SERVER_HOSTNAME,
              port: await reserveLoopbackPort(LOCAL_AGENT_SERVER_HOSTNAME),
            }
          : null

      const launchCommand = testStub
        ? { command: testStub.command, args: testStub.args, effectiveModel: model }
        : buildAgentLaunchCommand({
            provider,
            mode,
            prompt: mode === 'new' ? payload.prompt : '',
            model,
            resumeSessionId: mode === 'resume' ? (payload.resumeSessionId ?? null) : null,
            agentFullAccess,
            opencodeServer,
          })
      logAgentLaunchInfo(
        'control-surface-mount-local-command-built',
        'Built local mount agent launch command before spawn resolution.',
        describeAgentLaunchCommand({
          provider,
          mode,
          cwd,
          command: launchCommand.command,
          args: launchCommand.args,
          executablePathOverride,
        }),
      )

      const startedAtMs = Date.now()
      const startedAt = new Date(startedAtMs).toISOString()

      const opencodeTuiConfigPath =
        provider === 'opencode' ? await ensureOpenCodeEmbeddedTuiConfigPath() : null

      const sessionEnv =
        opencodeServer && provider === 'opencode'
          ? {
              OPENCOVE_OPENCODE_SERVER_HOSTNAME: opencodeServer.hostname,
              OPENCOVE_OPENCODE_SERVER_PORT: String(opencodeServer.port),
              XDG_STATE_HOME: resolveOpenCodeEmbeddedXdgStateHome(deps.userDataPath),
              ...(opencodeTuiConfigPath ? { OPENCODE_TUI_CONFIG: opencodeTuiConfigPath } : {}),
            }
          : undefined

      const launchEnv =
        testStub?.env || sessionEnv ? { ...(testStub?.env ?? {}), ...(sessionEnv ?? {}) } : null

      const mergedEnv =
        payload.env && Object.keys(payload.env).length > 0
          ? { ...(launchEnv ?? {}), ...payload.env }
          : (launchEnv ?? undefined)

      const resolvedSpawn = await resolveSessionLaunchSpawn({
        workingDirectory: cwd,
        defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
        command: launchCommand.command,
        args: launchCommand.args,
        provider: testStub ? null : provider,
        executablePathOverride,
        ...(mergedEnv ? { env: mergedEnv } : {}),
      }).catch(error => {
        logAgentLaunchError(
          'control-surface-mount-local-spawn-resolve-failed',
          'Failed to resolve local mount spawn.',
          {
            mountId: payload.mountId,
            provider,
            mode,
            cwd,
            ...describeAgentLaunchError(error),
          },
        )
        throw error
      })
      logAgentLaunchInfo(
        'control-surface-mount-local-spawn-resolved',
        'Resolved local mount agent spawn command.',
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
        provider === 'gemini' && mode === 'new'
          ? await captureGeminiSessionDiscoveryCursor(cwd).catch(() => null)
          : undefined

      const spawnCols = payload.cols ?? 80
      const spawnRows = payload.rows ?? 24
      logAgentLaunchInfo(
        'control-surface-mount-local-pty-spawn-start',
        'Spawning local mount agent PTY session.',
        {
          mountId: payload.mountId,
          provider,
          mode,
          cwd: resolvedSpawn.cwd,
          cols: spawnCols,
          rows: spawnRows,
          command: resolvedSpawn.command,
          argCount: resolvedSpawn.args.length,
        },
      )
      const { sessionId } = await deps.ptyRuntime
        .spawnSession({
          cwd: resolvedSpawn.cwd,
          cols: spawnCols,
          rows: spawnRows,
          command: resolvedSpawn.command,
          args: resolvedSpawn.args,
          ...resolveAgentPtySpawnState(provider, payload.prompt, mode),
          ...(resolvedSpawn.env ? { env: resolvedSpawn.env } : {}),
        })
        .catch(error => {
          logAgentLaunchError(
            'control-surface-mount-local-pty-spawn-failed',
            'Local mount PTY spawn failed.',
            {
              mountId: payload.mountId,
              provider,
              mode,
              cwd: resolvedSpawn.cwd,
              cols: spawnCols,
              rows: spawnRows,
              command: resolvedSpawn.command,
              ...describeAgentLaunchError(error),
            },
          )
          throw error
        })
      logAgentLaunchInfo(
        'control-surface-mount-local-pty-spawn-succeeded',
        'Local mount agent PTY session spawned.',
        {
          mountId: payload.mountId,
          provider,
          mode,
          cwd: resolvedSpawn.cwd,
          sessionId,
          cols: spawnCols,
          rows: spawnRows,
        },
      )

      startAgentSessionStateWatcherIfEnabled({
        ptyRuntime: deps.ptyRuntime,
        sessionId,
        provider,
        cwd,
        launchMode: mode,
        resumeSessionId: mode === 'resume' ? (payload.resumeSessionId ?? null) : null,
        startedAtMs,
        ...(geminiDiscoveryCursor !== undefined ? { geminiDiscoveryCursor } : {}),
        opencodeBaseUrl: opencodeServer
          ? `http://${opencodeServer.hostname}:${String(opencodeServer.port)}`
          : null,
      })

      const executionContext = resolveExecutionContextDto(cwd, {
        projectId: null,
        spaceId: null,
        mountId: payload.mountId,
        targetId: target.targetId,
        endpointId: 'local',
        endpointKind: 'local',
        targetRootPath: target.rootPath,
        targetRootUri: target.rootUri,
        scopeRootPath: target.rootPath,
        scopeRootUri: target.rootUri,
      })

      const record: SessionRecord = {
        sessionId,
        provider,
        startedAt,
        cwd,
        prompt: payload.prompt,
        model,
        effectiveModel: launchCommand.effectiveModel,
        executionContext,
        resumeSessionId: mode === 'resume' ? (payload.resumeSessionId ?? null) : null,
        startedAtMs,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
        launchMode: mode,
        ...(geminiDiscoveryCursor !== undefined ? { geminiDiscoveryCursor } : {}),
        route: { kind: 'local' },
      }

      deps.sessions.set(sessionId, record)
      deps.ptyStreamHub.registerSessionMetadata({
        sessionId,
        kind: 'agent',
        startedAt,
        cwd,
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
        resumeSessionId: record.resumeSessionId ?? null,
        effectiveModel: launchCommand.effectiveModel,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
      }
    },
    defaultErrorCode: 'agent.launch_failed',
  })
}
