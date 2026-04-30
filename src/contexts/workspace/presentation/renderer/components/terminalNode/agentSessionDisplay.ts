import type { AgentSessionSummary } from '@shared/contracts/dto'

export interface AgentSessionDisplaySummary {
  title: string
  subtitle: string | null
  identity: string | null
}

function normalizeDisplayText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function toAgentSessionDisplaySummary(
  summary: AgentSessionSummary,
): AgentSessionDisplaySummary {
  const title = normalizeDisplayText(summary.title)
  const preview = normalizeDisplayText(summary.preview)
  const sessionId = normalizeDisplayText(summary.sessionId)

  if (title) {
    const subtitle = preview && preview !== title ? preview : sessionId
    const identity = subtitle === sessionId ? null : sessionId

    return {
      title,
      subtitle,
      identity,
    }
  }

  if (preview) {
    return {
      title: preview,
      subtitle: sessionId,
      identity: null,
    }
  }

  return {
    title: summary.sessionId,
    subtitle: null,
    identity: null,
  }
}
