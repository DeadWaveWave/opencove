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
}

const POLL_INTERVAL_MS = 200
const DEFAULT_TIMEOUT_MS = 2600
const CODEX_CANDIDATE_WINDOW_MS = 20_000

function wait(durationMs: number): Promise<void> {
  return new Promise(resolveWait => {
    setTimeout(resolveWait, durationMs)
  })
}

async function findCodexResumeSessionId(cwd: string, startedAtMs: number): Promise<string | null> {
  const files = await listCodexSessionFiles({ cwd, startedAtMs })
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
): Promise<string | null> {
  if (provider === 'codex') {
    return await findCodexResumeSessionId(cwd, startedAtMs)
  }

  if (provider === 'opencode') {
    return await findOpenCodeResumeSessionId(cwd, startedAtMs)
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
): Promise<string | null> {
  const detected = await tryFindResumeSessionId(provider, cwd, startedAtMs)
  if (detected) {
    return detected
  }

  if (Date.now() > deadline) {
    return null
  }

  await wait(POLL_INTERVAL_MS)
  return await pollResumeSessionId(provider, cwd, startedAtMs, deadline)
}

export async function locateAgentResumeSessionId({
  provider,
  cwd,
  startedAtMs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: LocateAgentResumeSessionInput): Promise<string | null> {
  // A directory and timestamp cannot identify which Claude invocation owns a transcript.
  // Managed launches supply --session-id; SessionStart hooks identify terminal launches.
  if (provider === 'claude-code') {
    return null
  }

  if (timeoutMs <= 0) {
    return await tryFindResumeSessionId(provider, cwd, startedAtMs)
  }

  const deadline = Date.now() + timeoutMs
  return await pollResumeSessionId(provider, cwd, startedAtMs, deadline)
}
