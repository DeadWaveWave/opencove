import type { AgentProviderId, TerminalSessionState } from '@shared/contracts/dto'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
}

function normalizeSessionLineCandidate(line: string): string | null {
  let start = 0
  let end = line.length

  while (start < end && isWhitespaceCode(line.charCodeAt(start))) {
    start += 1
  }

  while (end > start && isWhitespaceCode(line.charCodeAt(end - 1))) {
    end -= 1
  }

  if (start === end || line.charCodeAt(start) !== 0x7b) {
    return null
  }

  return start === 0 && end === line.length ? line : line.slice(start, end)
}

function mayContainTurnState(provider: AgentProviderId, line: string): boolean {
  if (!line.includes('"type"')) {
    return false
  }

  if (provider === 'claude-code') {
    return line.includes('"assistant"') || line.includes('"user"')
  }

  return line.includes('"response_item"') || line.includes('"event_msg"')
}

function hasContentBlockType(message: Record<string, unknown>, blockType: string): boolean {
  if (!Array.isArray(message.content)) {
    return false
  }

  return message.content.some(block => {
    return isRecord(block) && block.type === blockType
  })
}

function detectCodexAssistantMessageState(
  payload: Record<string, unknown>,
  options: { fallbackToStandbyWithoutPhase: boolean },
): TerminalSessionState | null {
  if (payload.phase === 'commentary') {
    return 'working'
  }

  if (payload.phase === 'final_answer') {
    return 'standby'
  }

  return options.fallbackToStandbyWithoutPhase ? 'standby' : null
}

function detectClaudeTurnState(parsed: unknown): TerminalSessionState | null {
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null
  }

  if (parsed.type === 'assistant') {
    const message = parsed.message
    if (!isRecord(message)) {
      return null
    }

    if (hasContentBlockType(message, 'tool_use') || hasContentBlockType(message, 'thinking')) {
      return 'working'
    }

    if (hasContentBlockType(message, 'text')) {
      return 'standby'
    }

    if (message.stop_reason === null) {
      return 'working'
    }

    if (typeof message.stop_reason === 'string') {
      return 'standby'
    }

    return null
  }

  if (parsed.type === 'user') {
    return 'working'
  }

  return null
}

// Codex's authoritative working indicator lives in the TUI's in-memory
// turn lifecycle (`task_running`), not in any single rollout message. This
// detector therefore uses a file-level fallback: keep `commentary` in
// `working`, only downgrade assistant messages to `standby` at `final_answer`
// (or legacy no-phase compatibility), and ignore legacy `user_message` /
// `agent_message` boundaries because they are not reliable turn-state owners.
function detectCodexTurnState(parsed: unknown): TerminalSessionState | null {
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null
  }

  if (parsed.type === 'response_item') {
    const payload = parsed.payload
    if (!isRecord(payload) || typeof payload.type !== 'string') {
      return null
    }

    if (payload.type === 'message') {
      if (payload.role !== 'assistant') {
        return null
      }

      return detectCodexAssistantMessageState(payload, {
        fallbackToStandbyWithoutPhase: true,
      })
    }

    if (
      payload.type === 'reasoning' ||
      payload.type === 'function_call' ||
      payload.type === 'function_call_output'
    ) {
      return 'working'
    }
  }

  if (parsed.type === 'event_msg') {
    const payload = parsed.payload
    if (!isRecord(payload) || typeof payload.type !== 'string') {
      return null
    }

    if (payload.type === 'agent_reasoning') {
      return 'working'
    }

    if (payload.type === 'agent_message') {
      return detectCodexAssistantMessageState(payload, {
        fallbackToStandbyWithoutPhase: false,
      })
    }

    if (payload.type === 'turn_aborted') {
      return 'standby'
    }
  }

  return null
}

export function detectTurnStateFromSessionRecord(
  provider: AgentProviderId,
  parsed: unknown,
): TerminalSessionState | null {
  if (provider === 'claude-code') {
    return detectClaudeTurnState(parsed)
  }

  return detectCodexTurnState(parsed)
}

export function detectTurnStateFromSessionLine(
  provider: AgentProviderId,
  line: string,
): TerminalSessionState | null {
  const candidate = normalizeSessionLineCandidate(line)
  if (!candidate || !mayContainTurnState(provider, candidate)) {
    return null
  }

  try {
    const parsed = JSON.parse(candidate)
    return detectTurnStateFromSessionRecord(provider, parsed)
  } catch {
    return null
  }
}
