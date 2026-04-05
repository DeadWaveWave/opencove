import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type {
  AgentProviderId,
  LaunchAgentInput,
  LaunchAgentResult,
  ListAgentModelsInput,
  ListAgentModelsResult,
  ListInstalledAgentProvidersResult,
  ReadAgentLastMessageInput,
  ReadAgentLastMessageResult,
  ResolveAgentResumeSessionInput,
  ResolveAgentResumeSessionResult,
} from '../../../shared/contracts/dto'
import { createAppError } from '../../../shared/errors/appError'
import type { IpcRegistrationDisposable } from './types'
import { registerHandledIpc } from './handle'
import type {
  ControlSurfaceRemoteEndpoint,
  ControlSurfaceRemoteEndpointResolver,
} from '../controlSurface/remote/controlSurfaceHttpClient'
import { invokeControlSurface } from '../controlSurface/remote/controlSurfaceHttpClient'
import type { PtyRuntime } from '../../../contexts/terminal/presentation/main-ipc/runtime'
import { isRemotePtyRuntime } from '../controlSurface/remote/remotePtyRuntime'
import { AGENT_PROVIDERS } from '../../../contexts/settings/domain/agentSettings.providers'

function normalizeRequiredString(value: unknown, debugName: string): string {
  if (typeof value !== 'string') {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}` })
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}` })
  }

  return trimmed
}

function normalizeStartedAtMs(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid startedAt timestamp' })
  }

  return timestamp
}

async function resolveWorkerEndpoint(
  resolver: ControlSurfaceRemoteEndpointResolver,
): Promise<ControlSurfaceRemoteEndpoint> {
  const endpoint = await resolver()
  if (!endpoint) {
    throw createAppError('worker.unavailable')
  }

  return endpoint
}

async function invokeOk<TValue>(
  endpoint: ControlSurfaceRemoteEndpoint,
  request: { kind: 'query' | 'command'; id: string; payload: unknown },
): Promise<TValue> {
  const { httpStatus, result } = await invokeControlSurface(endpoint, request)
  if (httpStatus !== 200 || !result) {
    throw createAppError('common.unexpected', {
      debugMessage: `Worker invoke failed (HTTP ${httpStatus}).`,
    })
  }

  if (result.ok !== true) {
    throw createAppError(result.error)
  }

  return result.value as TValue
}

type AgentSessionLookup = {
  sessionId: string
  startedAtMs: number
}

async function resolveAgentSessionIdForLookup(options: {
  endpoint: ControlSurfaceRemoteEndpoint
  provider: AgentProviderId
  cwd: string
  startedAt: string
}): Promise<AgentSessionLookup | null> {
  const desiredStartedAtMs = normalizeStartedAtMs(options.startedAt)

  const list = await invokeOk<{
    sessions: Array<{ sessionId: string; kind: string; cwd: string; startedAt: string }>
  }>(options.endpoint, { kind: 'query', id: 'session.list', payload: null })

  const candidates = list.sessions
    .filter(session => session.kind === 'agent' && session.cwd.trim() === options.cwd.trim())
    .map(session => ({
      sessionId: session.sessionId,
      startedAtMs: Date.parse(session.startedAt),
    }))
    .filter(candidate => Number.isFinite(candidate.startedAtMs))

  if (candidates.length === 0) {
    return null
  }

  const scored = await Promise.all(
    candidates.map(async candidate => {
      try {
        const info = await invokeOk<{ provider: AgentProviderId; startedAt: string }>(
          options.endpoint,
          { kind: 'query', id: 'session.get', payload: { sessionId: candidate.sessionId } },
        )
        if (info.provider !== options.provider) {
          return null
        }

        const startedAtMs = Date.parse(info.startedAt)
        const delta = Math.abs(startedAtMs - desiredStartedAtMs)
        return { sessionId: candidate.sessionId, startedAtMs, delta }
      } catch {
        return null
      }
    }),
  )

  const matches = scored.filter(
    (candidate): candidate is { sessionId: string; startedAtMs: number; delta: number } =>
      candidate !== null,
  )

  if (matches.length === 0) {
    return null
  }

  matches.sort((a, b) => a.delta - b.delta)
  const best = matches[0]
  if (!best) {
    return null
  }

  // Be tolerant of renderer-side timestamps (they do not round-trip startedAt from the worker).
  if (best.delta > 10 * 60 * 1000) {
    return null
  }

  return { sessionId: best.sessionId, startedAtMs: best.startedAtMs }
}

export function registerRemoteAgentIpcHandlers(options: {
  endpointResolver: ControlSurfaceRemoteEndpointResolver
  ptyRuntime: PtyRuntime
}): IpcRegistrationDisposable {
  const noteControlledSession = (sessionId: string): void => {
    if (isRemotePtyRuntime(options.ptyRuntime)) {
      options.ptyRuntime.noteSessionRolePreference(sessionId, 'controller')
    }
  }

  registerHandledIpc(
    IPC_CHANNELS.agentListInstalledProviders,
    async (): Promise<ListInstalledAgentProvidersResult> => ({ providers: [...AGENT_PROVIDERS] }),
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.agentListModels,
    async (_event, payload: ListAgentModelsInput): Promise<ListAgentModelsResult> => {
      const provider = payload?.provider as AgentProviderId
      const fetchedAt = new Date().toISOString()
      const source =
        provider === 'claude-code'
          ? 'claude-static'
          : provider === 'opencode'
            ? 'opencode-cli'
            : provider === 'gemini'
              ? 'gemini-cli'
              : 'codex-cli'

      return {
        provider,
        source,
        fetchedAt,
        models: [],
        error: null,
      }
    },
    { defaultErrorCode: 'agent.list_models_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.agentLaunch,
    async (_event, payload: LaunchAgentInput): Promise<LaunchAgentResult> => {
      const cwd = normalizeRequiredString(payload?.cwd, 'agent.launch cwd')
      const provider = payload?.provider as AgentProviderId
      const model = payload?.model ?? null
      const mode = payload?.mode === 'resume' ? 'resume' : 'new'
      const resumeSessionId =
        typeof payload?.resumeSessionId === 'string' && payload.resumeSessionId.trim().length > 0
          ? payload.resumeSessionId.trim()
          : null

      const endpoint = await resolveWorkerEndpoint(options.endpointResolver)

      const launched = await invokeOk<{
        sessionId: string
        provider: AgentProviderId
        startedAt: string
        resumeSessionId: string | null
        effectiveModel: string | null
        command: string
        args: string[]
      }>(endpoint, {
        kind: 'command',
        id: 'session.launchAgent',
        payload: {
          cwd,
          prompt: typeof payload?.prompt === 'string' ? payload.prompt : '',
          provider,
          mode,
          model,
          resumeSessionId,
          agentFullAccess: payload?.agentFullAccess ?? null,
        },
      })

      noteControlledSession(launched.sessionId)

      return {
        sessionId: launched.sessionId,
        provider: launched.provider,
        profileId: payload?.profileId ?? null,
        command: launched.command,
        args: launched.args,
        launchMode: mode,
        effectiveModel: launched.effectiveModel,
        resumeSessionId: launched.resumeSessionId,
      }
    },
    { defaultErrorCode: 'agent.launch_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.agentResolveResumeSession,
    async (
      _event,
      payload: ResolveAgentResumeSessionInput,
    ): Promise<ResolveAgentResumeSessionResult> => {
      const provider = payload?.provider as AgentProviderId
      const cwd = normalizeRequiredString(payload?.cwd, 'agent.resolveResumeSession cwd')
      const startedAt = normalizeRequiredString(
        payload?.startedAt,
        'agent.resolveResumeSession startedAt',
      )

      const endpoint = await resolveWorkerEndpoint(options.endpointResolver)
      const lookup = await resolveAgentSessionIdForLookup({ endpoint, provider, cwd, startedAt })
      if (!lookup) {
        return { resumeSessionId: null }
      }

      const final = await invokeOk<{ resumeSessionId: string | null }>(endpoint, {
        kind: 'query',
        id: 'session.finalMessage',
        payload: { sessionId: lookup.sessionId },
      })

      return { resumeSessionId: final.resumeSessionId ?? null }
    },
    { defaultErrorCode: 'agent.resume_session_resolve_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.agentReadLastMessage,
    async (_event, payload: ReadAgentLastMessageInput): Promise<ReadAgentLastMessageResult> => {
      const provider = payload?.provider as AgentProviderId
      const cwd = normalizeRequiredString(payload?.cwd, 'agent.readLastMessage cwd')
      const startedAt = normalizeRequiredString(
        payload?.startedAt,
        'agent.readLastMessage startedAt',
      )

      const endpoint = await resolveWorkerEndpoint(options.endpointResolver)
      const lookup = await resolveAgentSessionIdForLookup({ endpoint, provider, cwd, startedAt })
      if (!lookup) {
        return { message: null }
      }

      const final = await invokeOk<{ message: string | null }>(endpoint, {
        kind: 'query',
        id: 'session.finalMessage',
        payload: { sessionId: lookup.sessionId },
      })

      return { message: final.message ?? null }
    },
    { defaultErrorCode: 'agent.read_last_message_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.agentListModels)
      ipcMain.removeHandler(IPC_CHANNELS.agentListInstalledProviders)
      ipcMain.removeHandler(IPC_CHANNELS.agentLaunch)
      ipcMain.removeHandler(IPC_CHANNELS.agentResolveResumeSession)
      ipcMain.removeHandler(IPC_CHANNELS.agentReadLastMessage)
    },
  }
}
