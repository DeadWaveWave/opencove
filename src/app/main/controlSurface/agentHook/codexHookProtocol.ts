export type CodexHookTurnState = 'working' | 'waiting' | 'done'

export interface CodexHookInput {
  session_id: string
  transcript_path: string | null
  cwd: string
  hook_event_name: string
  model: string
  tool_name?: string
  tool_use_id?: string
  tool_input?: unknown
}

export interface CodexHookEnvelope {
  version: 1
  state: CodexHookTurnState
  hookEventName: string
  codexSessionId: string
  tool?: {
    name: string
    useId: string | null
    input: unknown
  }
}

const WAITING_EVENTS = new Set(['PermissionRequest'])
const DONE_EVENTS = new Set(['Stop', 'SessionEnd'])
const WORKING_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  return record[key] === undefined ? null : requiredString(record, key)
}

export function resolveCodexHookState(eventName: string): CodexHookTurnState | null {
  // Codex currently has no dedicated lifecycle event for a free-text model question. Keep waiting
  // classification centralized here so a future authoritative event can be added without changing
  // the channel or runtime ownership model.
  if (WAITING_EVENTS.has(eventName)) {
    return 'waiting'
  }
  if (DONE_EVENTS.has(eventName)) {
    return 'done'
  }
  return WORKING_EVENTS.has(eventName) ? 'working' : null
}

export function validateCodexHookEnvelope(value: unknown): CodexHookEnvelope | null {
  if (!isRecord(value) || value.version !== 1) {
    return null
  }
  const state = value.state
  const hookEventName = requiredString(value, 'hookEventName')
  const codexSessionId = requiredString(value, 'codexSessionId')
  if (
    (state !== 'working' && state !== 'waiting' && state !== 'done') ||
    !hookEventName ||
    !codexSessionId
  ) {
    return null
  }

  let tool: CodexHookEnvelope['tool']
  if (value.tool !== undefined) {
    if (!isRecord(value.tool)) {
      return null
    }
    const name = requiredString(value.tool, 'name')
    const useId = value.tool.useId
    if (!name || (useId !== null && typeof useId !== 'string')) {
      return null
    }
    tool = { name, useId, input: value.tool.input ?? null }
  }

  return {
    version: 1,
    state,
    hookEventName,
    codexSessionId,
    ...(tool ? { tool } : {}),
  }
}

export function normalizeCodexHookEnvelope(value: unknown): CodexHookEnvelope | null {
  if (!isRecord(value)) {
    return null
  }
  const codexSessionId = requiredString(value, 'session_id')
  const cwd = requiredString(value, 'cwd')
  const hookEventName = requiredString(value, 'hook_event_name')
  if (!codexSessionId || !cwd || !hookEventName) {
    return null
  }

  const toolName = optionalString(value, 'tool_name')
  if ('tool_name' in value && !toolName) {
    return null
  }
  const state = resolveCodexHookState(hookEventName)
  if (!state) {
    return null
  }

  return {
    version: 1,
    state,
    hookEventName,
    codexSessionId,
    ...(toolName
      ? {
          tool: {
            name: toolName,
            useId: optionalString(value, 'tool_use_id'),
            input: value.tool_input ?? null,
          },
        }
      : {}),
  }
}
