import fs from 'node:fs/promises'
import type { AgentProviderId } from '../../../../../../shared/contracts/dto'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeMessageText(value: string): string | null {
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
  if (payload.type !== 'agent_message') {
    return null
  }

  if (typeof payload.message === 'string') {
    return normalizeMessageText(payload.message)
  }

  return null
}

export function extractLastAssistantMessageFromSessionRecord(
  provider: AgentProviderId,
  parsed: unknown,
): string | null {
  if (provider === 'claude-code') {
    return extractClaudeAssistantMessage(parsed)
  }

  return extractCodexAssistantMessage(parsed)
}

export async function readLastAssistantMessageFromSessionFile(
  provider: AgentProviderId,
  filePath: string,
): Promise<string | null> {
  const content = await fs.readFile(filePath, 'utf8')
  const lines = content.split('\n')
  let lastMessage: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0 || !line.startsWith('{')) {
      continue
    }

    try {
      const parsed = JSON.parse(line)
      const extracted = extractLastAssistantMessageFromSessionRecord(provider, parsed)
      if (extracted) {
        lastMessage = extracted
      }
    } catch {
      continue
    }
  }

  return lastMessage
}
