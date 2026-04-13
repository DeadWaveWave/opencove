import type { ControlSurface } from '../controlSurface'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { buildAgentLaunchCommand } from '../../../../contexts/agent/infrastructure/cli/AgentCommandFactory'
import { locateAgentResumeSessionId } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocator'
import {
  readLastAssistantMessageFromOpenCodeSession,
  readLastAssistantMessageFromSessionFile,
} from '../../../../contexts/agent/infrastructure/watchers/SessionLastAssistantMessage'
import { resolveSessionFilePath } from '../../../../contexts/agent/infrastructure/watchers/SessionFileResolver'
import { ensureOpenCodeEmbeddedTuiConfigPath } from '../../../../contexts/agent/infrastructure/opencode/OpenCodeTuiConfig'
import {
  normalizeAgentSettings,
  resolveAgentModel,
} from '../../../../contexts/settings/domain/agentSettings'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { ControlSurfacePtyRuntime } from './sessionPtyRuntime'
import type {
  AgentProviderId,
  GetSessionFinalMessageInput,
  GetSessionFinalMessageResult,
  GetSessionInput,
  GetSessionResult,
  LaunchAgentSessionInput,
  LaunchAgentSessionResult,
} from '../../../../shared/contracts/dto'
import {
  reserveLoopbackPort,
  resolveExecutionContextDto,
  resolveProviderFromSettings,
  resolveSessionLaunchSpawn,
} from './sessionLaunchSupport'
import { resolveSpaceWorkingDirectoryFromStore } from './resolveSpaceWorkingDirectoryFromStore'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import { resolveWorkerAgentTestStub } from './sessionAgentTestStub'

const OPENCODE_SERVER_HOSTNAME = '127.0.0.1'
const RESUME_SESSION_LOCATE_TIMEOUT_MS = 3_000
const SESSION_FILE_RESOLVE_TIMEOUT_MS = 1_500

function resolveOpenCodeEmbeddedXdgStateHome(userDataPath: string): string {
  return userDataPath.trim() || process.cwd()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeAgentProviderId(value: unknown): AgentProviderId | null {
  const provider = normalizeOptionalString(value)
  if (!provider) {
    return null
  }

  if (
    provider === 'claude-code' ||
    provider === 'codex' ||
    provider === 'opencode' ||
    provider === 'gemini'
  ) {
    return provider
  }

  throw createAppError('common.invalid_input', {
    debugMessage: `Invalid payload for session.launchAgent provider: ${provider}`,
  })
}

function normalizeLaunchAgentPayload(payload: unknown): LaunchAgentSessionInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (spaceIdRaw !== undefined && spaceIdRaw !== null && typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent spaceId.',
    })
  }

  const spaceId = typeof spaceIdRaw === 'string' ? spaceIdRaw.trim() : ''

  const cwdRaw = payload.cwd
  if (cwdRaw !== undefined && cwdRaw !== null && typeof cwdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent cwd.',
    })
  }

  const cwd = typeof cwdRaw === 'string' ? cwdRaw.trim() : ''

  const promptRaw = payload.prompt
  if (typeof promptRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent prompt.',
    })
  }

  const prompt = promptRaw.trim()

  const providerRaw = payload.provider
  if (providerRaw !== undefined && providerRaw !== null && typeof providerRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent provider.',
    })
  }

  const provider = normalizeAgentProviderId(providerRaw)

  const modelRaw = payload.model
  if (modelRaw !== undefined && modelRaw !== null && typeof modelRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent model.',
    })
  }

  const model = modelRaw === null ? null : normalizeOptionalString(modelRaw)
  const agentFullAccess = payload.agentFullAccess
  const modeRaw = payload.mode

  if (modeRaw !== undefined && modeRaw !== null && typeof modeRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent mode.',
    })
  }

  const mode = modeRaw === 'resume' ? 'resume' : 'new'

  const resumeSessionIdRaw = payload.resumeSessionId
  if (
    resumeSessionIdRaw !== undefined &&
    resumeSessionIdRaw !== null &&
    typeof resumeSessionIdRaw !== 'string'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent resumeSessionId.',
    })
  }

  const resumeSessionId =
    resumeSessionIdRaw === null ? null : normalizeOptionalString(resumeSessionIdRaw)

  if (
    agentFullAccess !== undefined &&
    agentFullAccess !== null &&
    typeof agentFullAccess !== 'boolean'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent agentFullAccess.',
    })
  }

  if (spaceId.length === 0 && cwd.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'session.launchAgent requires either spaceId or cwd.',
    })
  }

  return {
    ...(spaceId.length > 0 ? { spaceId } : {}),
    ...(cwd.length > 0 ? { cwd } : {}),
    prompt,
    provider,
    mode,
    model,
    resumeSessionId,
    agentFullAccess: agentFullAccess ?? null,
  }
}

function normalizeSessionIdPayload(
  payload: unknown,
  operationId: string,
): GetSessionInput | GetSessionFinalMessageInput {
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

type SessionRecord = GetSessionResult & {
  startedAtMs: number
}

export function registerSessionHandlers(
  controlSurface: ControlSurface,
  deps: {
    userDataPath: string
    approvedWorkspaces: ApprovedWorkspaceStore
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyRuntime: ControlSurfacePtyRuntime
    ptyStreamHub: PtyStreamHub
  },
): void {
  const sessions = new Map<string, SessionRecord>()

  controlSurface.register('session.launchAgent', {
    kind: 'command',
    validate: normalizeLaunchAgentPayload,
    handle: async (_ctx, payload): Promise<LaunchAgentSessionResult> => {
      const resolvedSpaceId = typeof payload.spaceId === 'string' ? payload.spaceId.trim() : ''
      const resolvedCwd = typeof payload.cwd === 'string' ? payload.cwd.trim() : ''
      const mode = payload.mode === 'resume' ? 'resume' : 'new'
      const resumeSessionId = normalizeOptionalString(payload.resumeSessionId)

      const { workingDirectory, agentSettings } = resolvedSpaceId
        ? await resolveSpaceWorkingDirectoryFromStore({
            spaceId: resolvedSpaceId,
            getPersistenceStore: deps.getPersistenceStore,
          })
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

      const provider = resolveProviderFromSettings(payload.provider ?? null, agentSettings)
      const model = payload.model ?? resolveAgentModel(agentSettings, provider)
      const agentFullAccess = payload.agentFullAccess ?? agentSettings.agentFullAccess

      const testStub = resolveWorkerAgentTestStub({
        provider,
        cwd: workingDirectory,
        mode,
        model,
      })

      const opencodeServer =
        provider === 'opencode' && !testStub
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
            resumeSessionId,
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

      const resolvedSpawn = await resolveSessionLaunchSpawn({
        workingDirectory,
        defaultTerminalProfileId: agentSettings.defaultTerminalProfileId,
        command: launchCommand.command,
        args: launchCommand.args,
        ...(sessionEnv ? { env: sessionEnv } : {}),
      })

      const { sessionId } = await deps.ptyRuntime.spawnSession({
        cwd: resolvedSpawn.cwd,
        cols: 80,
        rows: 24,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
        ...(resolvedSpawn.env ? { env: resolvedSpawn.env } : {}),
      })

      const executionContext = resolveExecutionContextDto(workingDirectory)

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
      }

      sessions.set(sessionId, record)
      deps.ptyStreamHub.registerSessionMetadata({
        sessionId,
        kind: 'agent',
        startedAt,
        cwd: workingDirectory,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
      })

      return {
        sessionId,
        provider,
        startedAt,
        executionContext,
        resumeSessionId,
        effectiveModel: launchCommand.effectiveModel,
        command: resolvedSpawn.command,
        args: resolvedSpawn.args,
      }
    },
    defaultErrorCode: 'agent.launch_failed',
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

      const { startedAtMs: _startedAtMs, ...publicRecord } = record
      return publicRecord
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('session.finalMessage', {
    kind: 'query',
    validate: payload => normalizeSessionIdPayload(payload, 'session.finalMessage'),
    handle: async (_ctx, payload): Promise<GetSessionFinalMessageResult> => {
      const record = sessions.get(payload.sessionId)
      if (!record) {
        throw createAppError('session.not_found', {
          debugMessage: `session.finalMessage: unknown session id: ${payload.sessionId}`,
        })
      }

      const startedAtMs = record.startedAtMs
      const resumeSessionId =
        record.resumeSessionId ??
        (await locateAgentResumeSessionId({
          provider: record.provider,
          cwd: record.cwd,
          startedAtMs,
          timeoutMs: RESUME_SESSION_LOCATE_TIMEOUT_MS,
        }))

      if (resumeSessionId) {
        record.resumeSessionId = resumeSessionId
      }

      if (!resumeSessionId) {
        return {
          sessionId: record.sessionId,
          provider: record.provider,
          startedAt: record.startedAt,
          cwd: record.cwd,
          resumeSessionId: null,
          message: null,
        }
      }

      if (record.provider === 'opencode') {
        const message = await readLastAssistantMessageFromOpenCodeSession(
          resumeSessionId,
          record.cwd,
        )
        return {
          sessionId: record.sessionId,
          provider: record.provider,
          startedAt: record.startedAt,
          cwd: record.cwd,
          resumeSessionId,
          message,
        }
      }

      const sessionFilePath = await resolveSessionFilePath({
        provider: record.provider,
        cwd: record.cwd,
        sessionId: resumeSessionId,
        startedAtMs,
        timeoutMs: SESSION_FILE_RESOLVE_TIMEOUT_MS,
      })

      if (!sessionFilePath) {
        return {
          sessionId: record.sessionId,
          provider: record.provider,
          startedAt: record.startedAt,
          cwd: record.cwd,
          resumeSessionId,
          message: null,
        }
      }

      const message = await readLastAssistantMessageFromSessionFile(
        record.provider,
        sessionFilePath,
      )
      return {
        sessionId: record.sessionId,
        provider: record.provider,
        startedAt: record.startedAt,
        cwd: record.cwd,
        resumeSessionId,
        message,
      }
    },
    defaultErrorCode: 'agent.read_last_message_failed',
  })

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
