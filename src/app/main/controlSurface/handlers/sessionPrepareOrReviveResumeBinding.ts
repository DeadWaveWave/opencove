import { isResumeSessionBindingVerified } from '../../../../contexts/agent/domain/agentResumeBinding'
import { locateAgentResumeSessionId } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocator'
import {
  isRecoverableAgentWindowStatus,
  type NormalizedPersistedNode,
  type PersistedAgentLike,
} from './sessionPrepareOrReviveShared'

const RECENT_RESUME_SESSION_LOCATE_TIMEOUT_MS = 750
const COLD_RESUME_SESSION_LOCATE_TIMEOUT_MS = 0
const RECENT_RESUME_SESSION_LOCATE_WINDOW_MS = 30_000
const FUTURE_STARTED_AT_CLOCK_SKEW_MS = 5_000

export function resolvePrepareOrReviveResumeLocateTimeoutMs(
  startedAtMs: number,
  nowMs = Date.now(),
): number {
  if (!Number.isFinite(startedAtMs)) {
    return COLD_RESUME_SESSION_LOCATE_TIMEOUT_MS
  }

  const ageMs = nowMs - startedAtMs
  if (
    ageMs >= -FUTURE_STARTED_AT_CLOCK_SKEW_MS &&
    ageMs <= RECENT_RESUME_SESSION_LOCATE_WINDOW_MS
  ) {
    return RECENT_RESUME_SESSION_LOCATE_TIMEOUT_MS
  }

  return COLD_RESUME_SESSION_LOCATE_TIMEOUT_MS
}

export async function resolvePendingResumeSessionId(
  node: NormalizedPersistedNode,
  agent: PersistedAgentLike,
): Promise<string | null> {
  if (
    !isRecoverableAgentWindowStatus(node.status) ||
    typeof node.startedAt !== 'string' ||
    node.startedAt.trim().length === 0
  ) {
    return null
  }

  if (isResumeSessionBindingVerified(agent)) {
    return agent.resumeSessionId
  }

  const startedAtMs = Date.parse(node.startedAt)
  if (!Number.isFinite(startedAtMs)) {
    return null
  }

  return await locateAgentResumeSessionId({
    provider: agent.provider,
    cwd: agent.executionDirectory,
    startedAtMs,
    timeoutMs: resolvePrepareOrReviveResumeLocateTimeoutMs(startedAtMs),
  })
}
