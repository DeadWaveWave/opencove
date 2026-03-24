import type { AgentProviderId } from '@shared/contracts/dto'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeMessageText(value: string): string | null {
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  return normalized.length > 0 ? normalized : null
}

function collectTextContent(content: unknown, blockType: string, textKey: string): string | null {
  if (!Array.isArray(content)) {
    return null
  }

  const blocks = content
    .flatMap(block => {
      if (!isRecord(block) || block.type !== blockType || typeof block[textKey] !== 'string') {
        return []
      }

      const normalized = normalizeMessageText(block[textKey])
      return normalized ? [normalized] : []
    })
    .filter(text => text.length > 0)

  if (blocks.length === 0) {
    return null
  }

  return blocks.join('\n\n')
}

function collectStructuredText(content: unknown): string | null {
  if (typeof content === 'string') {
    return normalizeMessageText(content)
  }

  if (isRecord(content)) {
    const directText = typeof content.text === 'string' ? normalizeMessageText(content.text) : null
    if (directText) {
      return directText
    }

    return (
      collectStructuredText(content.content) ??
      collectStructuredText(content.parts) ??
      (typeof content.message === 'string' ? normalizeMessageText(content.message) : null)
    )
  }

  if (!Array.isArray(content)) {
    return null
  }

  const blocks = content
    .flatMap(item => {
      if (typeof item === 'string') {
        const normalized = normalizeMessageText(item)
        return normalized ? [normalized] : []
      }

      if (!isRecord(item)) {
        return []
      }

      const directText = typeof item.text === 'string' ? normalizeMessageText(item.text) : null
      if (directText) {
        return [directText]
      }

      const nestedContent =
        collectStructuredText(item.content) ??
        collectStructuredText(item.parts) ??
        (typeof item.message === 'string' ? normalizeMessageText(item.message) : null)

      return nestedContent ? [nestedContent] : []
    })
    .filter(text => text.length > 0)

  if (blocks.length === 0) {
    return null
  }

  return blocks.join('\n\n')
}

function extractClaudeAssistantMessage(parsed: unknown): string | null {
  if (!isRecord(parsed) || parsed.type !== 'assistant' || !isRecord(parsed.message)) {
    return null
  }

  return collectTextContent(parsed.message.content, 'text', 'text')
}

function extractCodexAssistantMessage(parsed: unknown): string | null {
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null
  }

  if (parsed.type === 'response_item') {
    const payload = parsed.payload
    if (!isRecord(payload) || payload.type !== 'message' || payload.role !== 'assistant') {
      return null
    }

    return collectTextContent(payload.content, 'output_text', 'text')
  }

  if (parsed.type !== 'event_msg' || !isRecord(parsed.payload)) {
    return null
  }

  const payload = parsed.payload
  if (payload.type === 'task_complete') {
    if (typeof payload.last_agent_message === 'string') {
      return normalizeMessageText(payload.last_agent_message)
    }

    return null
  }

  if (payload.type !== 'agent_message') {
    return null
  }

  if (typeof payload.message === 'string') {
    return normalizeMessageText(payload.message)
  }

  return null
}

function extractGeminiAssistantMessage(parsed: unknown): string | null {
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    return null
  }

  for (let index = parsed.messages.length - 1; index >= 0; index -= 1) {
    const message = parsed.messages[index]
    if (!isRecord(message)) {
      continue
    }

    const raw =
      typeof message.type === 'string'
        ? message.type
        : typeof message.role === 'string'
          ? message.role
          : null
    const normalized = raw ? raw.trim().toLowerCase() : ''

    if (
      normalized !== 'gemini' &&
      normalized !== 'assistant' &&
      normalized !== 'model' &&
      normalized !== 'bot'
    ) {
      continue
    }

    return (
      collectStructuredText(message.content) ??
      collectStructuredText(message.parts) ??
      collectStructuredText(message.message)
    )
  }

  return null
}

function extractOpenCodeAssistantMessage(parsed: unknown): string | null {
  let lastMessage: string | null = null

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }
      return
    }

    if (!isRecord(value)) {
      return
    }

    const role = typeof value.role === 'string' ? value.role : null
    const type = typeof value.type === 'string' ? value.type : null
    const isAssistantMessage =
      role === 'assistant' || role === 'model' || (type === 'message' && role === 'assistant')

    if (isAssistantMessage) {
      const extracted =
        collectStructuredText(value.parts) ??
        collectStructuredText(value.content) ??
        collectStructuredText(value.message)

      if (extracted) {
        lastMessage = extracted
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        visit(child)
      }
    }
  }

  visit(parsed)
  return lastMessage
}

export function extractLastAssistantMessageFromSessionData(
  provider: AgentProviderId,
  parsed: unknown,
): string | null {
  if (provider === 'claude-code') {
    return extractClaudeAssistantMessage(parsed)
  }

  if (provider === 'codex') {
    return extractCodexAssistantMessage(parsed)
  }

  if (provider === 'gemini') {
    return extractGeminiAssistantMessage(parsed)
  }

  if (provider === 'opencode') {
    return extractOpenCodeAssistantMessage(parsed)
  }

  return null
}
