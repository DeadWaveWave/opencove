import type { ListInstalledAgentProvidersResult } from '@shared/contracts/dto'
import { AGENT_PROVIDERS } from '@contexts/settings/domain/agentSettings'
import { invokeBrowserControlSurface } from './browserControlSurface'

type AgentApi = Window['opencoveApi']['agent']

function normalizeRequiredString(value: unknown, debugName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${debugName}`)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Missing ${debugName}`)
  }

  return trimmed
}

function normalizeStartedAtMs(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new Error('Invalid startedAt timestamp')
  }

  return timestamp
}

type AgentSessionLookup = {
  sessionId: string
  startedAtMs: number
}

async function resolveAgentSessionIdForLookup(options: {
  provider: string
  cwd: string
  startedAt: string
}): Promise<AgentSessionLookup | null> {
  const desiredStartedAtMs = normalizeStartedAtMs(options.startedAt)
  const desiredCwd = options.cwd.trim()

  const list = await invokeBrowserControlSurface<{
    sessions: Array<{ sessionId: string; kind: string; cwd: string; startedAt: string }>
  }>({ kind: 'query', id: 'session.list', payload: null })

  const candidates = list.sessions
    .filter(session => session.kind === 'agent' && session.cwd.trim() === desiredCwd)
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
        const info = await invokeBrowserControlSurface<{ provider: string; startedAt: string }>({
          kind: 'query',
          id: 'session.get',
          payload: { sessionId: candidate.sessionId },
        })
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

  if (best.delta > 10 * 60 * 1000) {
    return null
  }

  return { sessionId: best.sessionId, startedAtMs: best.startedAtMs }
}

export function createBrowserAgentApi(): AgentApi {
  return {
    listModels: async payload => ({
      provider: payload.provider,
      source:
        payload.provider === 'claude-code'
          ? 'claude-static'
          : payload.provider === 'codex'
            ? 'codex-cli'
            : payload.provider === 'opencode'
              ? 'opencode-cli'
              : 'gemini-cli',
      fetchedAt: new Date().toISOString(),
      models: [],
      error: null,
    }),
    listInstalledProviders: async (): Promise<ListInstalledAgentProvidersResult> => ({
      providers: [...AGENT_PROVIDERS],
    }),
    launch: async payload => {
      const cwd = payload.cwd.trim()

      if (cwd.length === 0) {
        throw new Error('agent.launch requires a cwd')
      }

      const mode = payload.mode === 'resume' ? 'resume' : 'new'
      const resumeSessionId =
        typeof payload.resumeSessionId === 'string' && payload.resumeSessionId.trim().length > 0
          ? payload.resumeSessionId.trim()
          : null

      const launched = await invokeBrowserControlSurface<{
        sessionId: string
        provider: string
        startedAt: string
        executionContext: unknown
        resumeSessionId: string | null
        effectiveModel: string | null
        command: string
        args: string[]
      }>({
        kind: 'command',
        id: 'session.launchAgent',
        payload: {
          cwd,
          prompt: payload.prompt,
          provider: payload.provider,
          mode,
          model: payload.model ?? null,
          resumeSessionId,
          agentFullAccess: payload.agentFullAccess ?? null,
        },
      })

      return {
        sessionId: launched.sessionId,
        provider: payload.provider,
        profileId: payload.profileId ?? null,
        runtimeKind: 'posix',
        command: launched.command,
        args: launched.args,
        launchMode: mode,
        effectiveModel: launched.effectiveModel,
        resumeSessionId: launched.resumeSessionId,
      }
    },
    readLastMessage: async payload => {
      const provider = payload?.provider
      const cwd = normalizeRequiredString(payload?.cwd, 'agent.readLastMessage cwd')
      const startedAt = normalizeRequiredString(
        payload?.startedAt,
        'agent.readLastMessage startedAt',
      )

      const lookup = await resolveAgentSessionIdForLookup({ provider, cwd, startedAt })
      if (!lookup) {
        return { message: null }
      }

      const final = await invokeBrowserControlSurface<{ message: string | null }>({
        kind: 'query',
        id: 'session.finalMessage',
        payload: { sessionId: lookup.sessionId },
      })

      return { message: final.message ?? null }
    },
    resolveResumeSessionId: async payload => {
      const provider = payload?.provider
      const cwd = normalizeRequiredString(payload?.cwd, 'agent.resolveResumeSession cwd')
      const startedAt = normalizeRequiredString(
        payload?.startedAt,
        'agent.resolveResumeSession startedAt',
      )

      const lookup = await resolveAgentSessionIdForLookup({ provider, cwd, startedAt })
      if (!lookup) {
        return { resumeSessionId: null }
      }

      const final = await invokeBrowserControlSurface<{ resumeSessionId: string | null }>({
        kind: 'query',
        id: 'session.finalMessage',
        payload: { sessionId: lookup.sessionId },
      })

      return { resumeSessionId: final.resumeSessionId ?? null }
    },
  }
}
