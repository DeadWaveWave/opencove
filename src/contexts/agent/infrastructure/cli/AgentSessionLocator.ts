import { waitForSessionReadRetry } from '../AgentSessionReadLifetime'
import type { AgentProviderId } from '@shared/contracts/dto'
import { listCodexSessionFiles, resolveCodexSessionTimestampMs } from './CodexSessionFiles'
import {
  findGeminiResumeSessionId,
  findOpenCodeResumeSessionId,
} from './AgentSessionLocatorProviders'
import { selectNearestAgentSessionId } from './AgentSessionCandidateSelector'
import {
  findKimiResumeSessionId,
  findPiResumeSessionId,
} from './AgentSessionLocatorProviders.piKimi'

interface LocateAgentResumeSessionInput {
  provider: AgentProviderId
  cwd: string
  startedAtMs: number
  timeoutMs?: number
  signal?: AbortSignal
}

const POLL_INTERVAL_MS = 200
const DEFAULT_TIMEOUT_MS = 2600
const CODEX_CANDIDATE_WINDOW_MS = 20_000

async function findCodexResumeSessionId(
  cwd: string,
  startedAtMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const files = await listCodexSessionFiles({ cwd, startedAtMs, signal })
  return selectNearestAgentSessionId({
    candidates: files.map(meta => ({
      sessionId: meta.sessionId,
      timestampMs: resolveCodexSessionTimestampMs(meta, startedAtMs),
    })),
    startedAtMs,
    maxDistanceMs: CODEX_CANDIDATE_WINDOW_MS,
  })
}

async function tryFindResumeSessionId(
  provider: AgentProviderId,
  cwd: string,
  startedAtMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted()
  if (provider === 'codex') {
    return await findCodexResumeSessionId(cwd, startedAtMs, signal)
  }

  if (provider === 'opencode') {
    return await findOpenCodeResumeSessionId(cwd, startedAtMs, signal)
  }

  if (provider === 'pi') {
    return await findPiResumeSessionId(cwd, startedAtMs)
  }

  if (provider === 'kimi') {
    return await findKimiResumeSessionId(cwd, startedAtMs)
  }

  return await findGeminiResumeSessionId(cwd, startedAtMs)
}

async function pollResumeSessionId(
  provider: AgentProviderId,
  cwd: string,
  startedAtMs: number,
  deadline: number,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted()
  const detected = await tryFindResumeSessionId(provider, cwd, startedAtMs, signal)
  signal?.throwIfAborted()
  if (detected) {
    return detected
  }

  if (Date.now() > deadline) {
    return null
  }

  await waitForSessionReadRetry(POLL_INTERVAL_MS, signal)
  return await pollResumeSessionId(provider, cwd, startedAtMs, deadline, signal)
}

export async function locateAgentResumeSessionId({
  provider,
  cwd,
  startedAtMs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: LocateAgentResumeSessionInput): Promise<string | null> {
  signal?.throwIfAborted()
  // A directory and timestamp cannot identify which Claude invocation owns a transcript.
  // Managed launches supply --session-id; SessionStart hooks identify terminal launches.
  if (provider === 'claude-code') {
    return null
  }

  if (timeoutMs <= 0) {
    const detected = await tryFindResumeSessionId(provider, cwd, startedAtMs, signal)
    signal?.throwIfAborted()
    return detected
  }

  const deadline = Date.now() + timeoutMs
  return await pollResumeSessionId(provider, cwd, startedAtMs, deadline, signal)
}
