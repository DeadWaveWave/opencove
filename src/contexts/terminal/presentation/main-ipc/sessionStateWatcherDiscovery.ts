import { locateAgentResumeSessionId } from '../../../agent/infrastructure/cli/AgentSessionLocator'
import {
  type GeminiSessionDiscoveryCursor,
  locateGeminiResumeSessionId,
} from '../../../agent/infrastructure/cli/AgentSessionLocatorProviders'
import { findOpenCodeSessionId } from '../../../agent/infrastructure/watchers/OpenCodeSessionApi'
import type { SessionStateWatcherStartInput } from './sessionStateWatcher'

export async function resolveDiscoveredSessionId({
  sessionId,
  input,
  startedAtHints,
  geminiDiscoveryCursorBySession,
  locateTimeoutMs,
}: {
  sessionId: string
  input: SessionStateWatcherStartInput
  startedAtHints: number[]
  geminiDiscoveryCursorBySession: Map<string, GeminiSessionDiscoveryCursor>
  locateTimeoutMs: number
}): Promise<string | null> {
  if (input.provider === 'opencode') {
    for (const startedAtMs of startedAtHints) {
      // Prefer filesystem/DB discovery so we can bind the resume session id even if the
      // embedded OpenCode server is still starting up.
      // eslint-disable-next-line no-await-in-loop
      const resolvedFromLocator = await locateAgentResumeSessionId({
        provider: input.provider,
        cwd: input.cwd,
        startedAtMs,
        timeoutMs: locateTimeoutMs,
      })

      if (resolvedFromLocator) {
        return resolvedFromLocator
      }

      if (!input.opencodeBaseUrl) {
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      const resolved = await findOpenCodeSessionId({
        baseUrl: input.opencodeBaseUrl,
        cwd: input.cwd,
        startedAtMs,
      })

      if (resolved) {
        return resolved
      }
    }

    return null
  }

  if (input.provider === 'gemini') {
    const discoveryCursor =
      input.launchMode === 'new' && !input.resumeSessionId
        ? (geminiDiscoveryCursorBySession.get(sessionId) ?? null)
        : null

    for (const startedAtMs of startedAtHints) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await locateGeminiResumeSessionId({
        cwd: input.cwd,
        startedAtMs,
        timeoutMs: locateTimeoutMs,
        discoveryCursor,
      })

      if (resolved) {
        return resolved
      }
    }

    return null
  }

  for (const startedAtMs of startedAtHints) {
    // eslint-disable-next-line no-await-in-loop
    const resolved = await locateAgentResumeSessionId({
      provider: input.provider,
      cwd: input.cwd,
      startedAtMs,
      timeoutMs: locateTimeoutMs,
    })

    if (resolved) {
      return resolved
    }
  }

  return null
}
