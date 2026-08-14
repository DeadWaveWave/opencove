export interface AgentSessionCandidate {
  sessionId: string
  timestampMs: number
}

export function selectNearestAgentSessionId(options: {
  candidates: AgentSessionCandidate[]
  startedAtMs: number
  maxDistanceMs: number
}): string | null {
  const nearestBySessionId = new Map<string, number>()

  for (const candidate of options.candidates) {
    const distanceMs = Math.abs(candidate.timestampMs - options.startedAtMs)
    if (distanceMs > options.maxDistanceMs) {
      continue
    }

    const previousDistanceMs = nearestBySessionId.get(candidate.sessionId)
    if (previousDistanceMs === undefined || distanceMs < previousDistanceMs) {
      nearestBySessionId.set(candidate.sessionId, distanceMs)
    }
  }

  const ranked = [...nearestBySessionId.entries()].sort(
    ([leftSessionId, leftDistanceMs], [rightSessionId, rightDistanceMs]) =>
      leftDistanceMs - rightDistanceMs ||
      (leftSessionId < rightSessionId ? -1 : leftSessionId > rightSessionId ? 1 : 0),
  )
  const nearest = ranked[0]
  if (!nearest || (ranked[1] && ranked[1][1] === nearest[1])) {
    return null
  }

  return nearest[0]
}
