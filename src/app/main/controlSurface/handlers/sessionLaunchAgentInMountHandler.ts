import type { ControlSurface } from '../controlSurface'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { buildAgentLaunchCommand } from '../../../../contexts/agent/infrastructure/cli/AgentCommandFactory'
import { ensureOpenCodeEmbeddedTuiConfigPath } from '../../../../contexts/agent/infrastructure/opencode/OpenCodeTuiConfig'
import {
  normalizeAgentSettings,
  resolveAgentModel,
} from '../../../../contexts/settings/domain/agentSettings'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type {
  LaunchAgentSessionInMountInput,
  LaunchAgentSessionInput,
  LaunchAgentSessionResult,
} from '../../../../shared/contracts/dto'
import {
  reserveLoopbackPort,
  resolveExecutionContextDto,
  resolveProviderFromSettings,
  resolveSessionLaunchSpawn,
} from './sessionLaunchSupport'
import { normalizeLaunchAgentEnv } from './sessionLaunchAgentEnv'
import { startAgentSessionStateWatcherIfEnabled } from './sessionStateWatcherStart'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { resolveWorkerAgentTestStub } from './sessionAgentTestStub'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { assertFileUriWithinRootUri } from '../topology/fileUriScope'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import type { MultiEndpointPtyRuntime } from '../ptyStream/multiEndpointPtyRuntime'
import type { SessionRecord } from './sessionRecords'
import {
  isRecord,
  normalizeAgentProviderId,
  normalizeFileSystemUri,
  normalizeOptionalString,
  normalizeOptionalPositiveInt,
  resolvePathFromFileSystemUriOrThrow,
} from './sessionLaunchPayloadSupport'

const OPENCODE_SERVER_HOSTNAME = '127.0.0.1'

function resolveOpenCodeEmbeddedXdgStateHome(userDataPath: string): string {
  const normalized = userDataPath.trim()
  return normalized.length > 0 ? normalized : process.cwd()
}

function normalizeLaunchAgentInMountPayload(payload: unknown): LaunchAgentSessionInMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount.',
    })
  }

  const mountId = normalizeOptionalString(payload.mountId)
  if (!mountId) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount mountId.',
    })
  }

  const cwdUriRaw = payload.cwdUri
  if (cwdUriRaw !== undefined && cwdUriRaw !== null && typeof cwdUriRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount cwdUri.',
    })
  }

  const promptRaw = payload.prompt
  if (typeof promptRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount prompt.',
    })
  }

  const provider = normalizeAgentProviderId(payload.provider, 'session.launchAgentInMount provider')

  const modelRaw = payload.model
  if (modelRaw !== undefined && modelRaw !== null && typeof modelRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount model.',
    })
  }

  const modeRaw = payload.mode
  if (modeRaw !== undefined && modeRaw !== null && typeof modeRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount mode.',
    })
  }

  const resumeSessionIdRaw = payload.resumeSessionId
  if (
    resumeSessionIdRaw !== undefined &&
    resumeSessionIdRaw !== null &&
    typeof resumeSessionIdRaw !== 'string'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount resumeSessionId.',
    })
  }

  const agentFullAccess = payload.agentFullAccess
  if (
    agentFullAccess !== undefined &&
    agentFullAccess !== null &&
    typeof agentFullAccess !== 'boolean'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgentInMount agentFullAccess.',
    })
  }

  const env = normalizeLaunchAgentEnv(payload.env)
  const cols = normalizeOptionalPositiveInt(payload.cols)
  const rows = normalizeOptionalPositiveInt(payload.rows)

  return {
    mountId,
    cwdUri:
      cwdUriRaw === undefined || cwdUriRaw === null
        ? null
        : normalizeFileSystemUri(cwdUriRaw, 'session.launchAgentInMount cwdUri'),
    prompt: promptRaw.trim(),
    provider,
    mode: modeRaw === 'resume' ? 'resume' : 'new',
    model: modelRaw === null ? null : normalizeOptionalString(modelRaw),
    resumeSessionId:
      resumeSessionIdRaw === null ? null : normalizeOptionalString(resumeSessionIdRaw),
    env,
    agentFullAccess: agentFullAccess ?? null,
    cols,
    rows,
  }
}

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
  },
): void {
  controlSurface.register('session.launchAgentInMount', {
    kind: 'command',
    validate: normalizeLaunchAgentInMountPayload,
    handle: async (_ctx, payload): Promise<LaunchAgentSessionResult> => {
      const target = await deps.topology.resolveMountTarget({ mountId: payload.mountId })
      if (!target) {
        throw createAppError('common.invalid_input', {
          debugMessage: `Unknown mountId: ${payload.mountId}`,
        })
      }

      const cwdUri = payload.cwdUri ?? target.rootUri
      assertFileUriWithinRootUri({
        rootUri: target.rootUri,
        uri: cwdUri,
        debugMessage: 'session.launchAgentInMount cwdUri is outside mount root',
      })

      const cwd = resolvePathFromFileSystemUriOrThrow(cwdUri, 'session.launchAgentInMount cwdUri')
      const mode = payload.mode ?? 'new'

      if (target.endpointId !== 'local') {
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
              agentFullAccess: payload.agentFullAccess ?? null,
              cols: payload.cols,
              rows: payload.rows,
            } satisfies LaunchAgentSessionInput,
          })

          if (!agentLaunchResult.result) {
            throw createAppError('worker.unavailable')
          }

          if (agentLaunchResult.result.ok === false) {
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
      const agentFullAccess = payload.agentFullAccess ?? agentSettings.agentFullAccess

      const testStub = resolveWorkerAgentTestStub({
        provider,
        cwd,
        mode,
        model,
      })

      const opencodeServer =
        provider === 'opencode'
          ? {
              hostname: OPENCODE_SERVER_HOSTNAME,
              port: await reserveLoopbackPort(OPENCODE_SERVER_HOSTNAME),
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
        ...(mergedEnv ? { env: mergedEnv } : {}),
      })

      const { sessionId } = await deps.ptyRuntime.spawnSession({
        cwd: resolvedSpawn.cwd,
        cols: payload.cols ?? 80,
        rows: payload.rows ?? 24,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
        ...(resolvedSpawn.env ? { env: resolvedSpawn.env } : {}),
      })

      startAgentSessionStateWatcherIfEnabled({
        ptyRuntime: deps.ptyRuntime,
        sessionId,
        provider,
        cwd,
        launchMode: mode,
        resumeSessionId: mode === 'resume' ? (payload.resumeSessionId ?? null) : null,
        startedAtMs,
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
        resumeSessionId: record.resumeSessionId ?? null,
        effectiveModel: launchCommand.effectiveModel,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
      }
    },
    defaultErrorCode: 'agent.launch_failed',
  })
}
