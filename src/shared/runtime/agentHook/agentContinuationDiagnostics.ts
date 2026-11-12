type Details = {
  sessionId?: string
  providerSessionId?: string
  promptId?: string
  turnId?: string
  kind?: string
  operation?: string
  generation?: number
  position?: number
  baseline?: boolean
  pending?: number
  elapsedMs?: number
  ready?: boolean
}
/** Explicit allowlist: never serialize envelopes, file paths, content, or error messages. */
export function debugAgentContinuation(event: string, details: Details = {}): void {
  if (process.env.OPENCOVE_DEBUG_AGENT_CONTINUATION !== '1') {
    return
  }
  const id = (value?: string) => value?.slice(0, 8).replace(/[^A-Za-z0-9_-]/g, '?')
  process.stderr.write(
    `[opencove-agent-continuation] ${JSON.stringify({
      at: Date.now(),
      event,
      sessionId: id(details.sessionId),
      providerSessionId: id(details.providerSessionId),
      promptId: id(details.promptId),
      turnId: id(details.turnId),
      kind: details.kind,
      operation: details.operation,
      generation: details.generation,
      position: details.position,
      baseline: details.baseline,
      pending: details.pending,
      elapsedMs: details.elapsedMs,
      ready: details.ready,
    })}\n`,
  )
}
