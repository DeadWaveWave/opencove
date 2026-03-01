import type { AgentProviderId, TerminalSessionState } from '../../../shared/types/api'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function hasContentBlockType(message: Record<string, unknown>, blockType: string): boolean {
  if (!Array.isArray(message.content)) {
    return false
  }

  return message.content.some(block => {
    return isRecord(block) && block.type === blockType
  })
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

    // Claude writes many streaming assistant chunks with stop_reason=null.
    // A non-null stop_reason means this assistant turn has stopped and is waiting.
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

function detectCodexTurnState(parsed: unknown): TerminalSessionState | null {
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null
  }

  if (parsed.type === 'response_item') {
    const payload = parsed.payload
    if (!isRecord(payload) || typeof payload.type !== 'string') {
      return null
    }

    if (payload.type === 'message' && payload.role === 'assistant') {
      return 'standby'
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

    if (
      payload.type === 'agent_reasoning' ||
      payload.type === 'agent_message' ||
      payload.type === 'user_message'
    ) {
      return 'working'
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
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed)
    return detectTurnStateFromSessionRecord(provider, parsed)
  } catch {
    return null
  }
}
