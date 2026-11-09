import { isAbsolute } from 'node:path'
import { claudeFinalMessage } from '../../../../shared/runtime/agentHook/claudeFinalMessage'
import {
  claudePromptDigest,
  claudePromptId,
} from '../../../../shared/runtime/agentHook/claudePromptEvidence'

export type ClaudeHookTurnState = 'working' | 'waiting' | 'done'
export type ClaudeSessionStartSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'

function sessionStartSource(value: unknown): ClaudeSessionStartSource | undefined {
  switch (value) {
    case 'startup':
    case 'resume':
    case 'clear':
    case 'compact':
    case 'fork':
      return value
    default:
      return undefined
  }
}

export interface ClaudeHookInput {
  session_id: string
  transcript_path: string
  cwd: string
  hook_event_name: string
  tool_name?: string
  tool_use_id?: string
  tool_input?: unknown
  prompt?: unknown
  prompt_id?: unknown
  source?: string
  notification_type?: string
}

export interface ClaudeHookEnvelope {
  version: 1
  emittedAtMs?: number
  // Session lifecycle/identity is not evidence of a task transition.
  state: ClaudeHookTurnState | null
  hookEventName: string
  claudeSessionId: string
  notificationType?: string
  sessionStartSource?: ClaudeSessionStartSource
  transcriptPath?: string
  promptId?: string
  promptDigest?: string
  finalMessage?: { message: string; truncated: boolean }
  tool?: {
    name: string
    useId: string | null
    input: unknown
  }
}

export function validateClaudeHookEnvelope(value: unknown): ClaudeHookEnvelope | null {
  if (!isRecord(value) || value.version !== 1) {
    return null
  }
  const state = value.state
  const hookEventName = requiredString(value, 'hookEventName')
  const claudeSessionId = requiredString(value, 'claudeSessionId')
  if (
    (state !== 'working' && state !== 'waiting' && state !== 'done' && state !== null) ||
    !hookEventName ||
    !claudeSessionId
  ) {
    return null
  }

  let tool: ClaudeHookEnvelope['tool']
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

  const sessionStartSourceValue =
    hookEventName === 'SessionStart'
      ? sessionStartSource(value.sessionStartSource ?? value.source)
      : undefined
  return {
    version: 1,
    // Older relays labeled SessionStart as working. Do not replay that inference.
    state: hookEventName === 'SessionStart' ? null : state,
    hookEventName,
    claudeSessionId,
    ...(typeof value.notificationType === 'string'
      ? { notificationType: value.notificationType }
      : {}),
    ...(sessionStartSourceValue ? { sessionStartSource: sessionStartSourceValue } : {}),
    ...(typeof value.transcriptPath === 'string' &&
    isAbsolute(value.transcriptPath) &&
    value.transcriptPath.length <= 4096 &&
    !value.transcriptPath.includes('\0')
      ? { transcriptPath: value.transcriptPath }
      : {}),
    ...(tool ? { tool } : {}),
  }
}

const WAITING_NOTIFICATION_TYPES = new Set([
  'permission_prompt',
  'agent_needs_input',
  'elicitation_dialog',
  'elicitation_url_dialog',
])

const WORKING_NOTIFICATION_TYPES = new Set(['elicitation_complete', 'elicitation_response'])

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
  const value = record[key]
  if (value === undefined) {
    return null
  }

  return requiredString(record, key)
}

function resolveState(
  eventName: string,
  toolName: string | null,
  notificationType: string | null,
): ClaudeHookTurnState | null | undefined {
  if (eventName === 'PermissionRequest') {
    return toolName ? 'waiting' : undefined
  }

  if (eventName === 'PreToolUse') {
    if (!toolName) {
      return undefined
    }
    return toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode' ? 'waiting' : 'working'
  }

  if (eventName === 'Notification') {
    if (!notificationType) {
      return undefined
    }
    if (notificationType === 'idle_prompt' || notificationType === 'auth_success') {
      return null
    }
    if (WAITING_NOTIFICATION_TYPES.has(notificationType)) {
      return 'waiting'
    }
    return WORKING_NOTIFICATION_TYPES.has(notificationType) ? 'working' : undefined
  }

  if (eventName === 'Stop' || eventName === 'StopFailure' || eventName === 'SessionEnd') {
    return 'done'
  }

  if (eventName === 'SessionStart') {
    // Includes startup/resume/clear and compaction during a live turn. The invocation
    // owner initializes idle; only turn hooks may change it or finish existing work.
    return null
  }

  if (
    eventName === 'UserPromptSubmit' ||
    eventName === 'PostToolUse' ||
    eventName === 'PostToolUseFailure' ||
    eventName === 'PermissionDenied'
  ) {
    return 'working'
  }

  return undefined
}

export function normalizeClaudeHookEnvelope(value: unknown): ClaudeHookEnvelope | null {
  if (!isRecord(value)) {
    return null
  }

  const claudeSessionId = requiredString(value, 'session_id')
  const transcriptPath = requiredString(value, 'transcript_path')
  const cwd = requiredString(value, 'cwd')
  const hookEventName = requiredString(value, 'hook_event_name')
  if (!claudeSessionId || !transcriptPath || !cwd || !hookEventName) {
    return null
  }

  const toolName = optionalString(value, 'tool_name')
  if ('tool_name' in value && !toolName) {
    return null
  }
  const notificationType = optionalString(value, 'notification_type')
  const state = resolveState(hookEventName, toolName, notificationType)
  if (state === undefined) {
    return null
  }

  const sessionStartSourceValue =
    hookEventName === 'SessionStart' ? sessionStartSource(value.source) : undefined
  return {
    version: 1,
    state,
    ...(notificationType ? { notificationType } : {}),
    hookEventName,
    claudeSessionId,
    ...(sessionStartSourceValue ? { sessionStartSource: sessionStartSourceValue } : {}),
    ...(isAbsolute(transcriptPath) &&
    transcriptPath.length <= 4096 &&
    !transcriptPath.includes('\0')
      ? { transcriptPath }
      : {}),
    ...(hookEventName === 'UserPromptSubmit'
      ? {
          promptId: claudePromptId(value.prompt_id),
          promptDigest:
            value.prompt_truncated === true ? undefined : claudePromptDigest(value.prompt),
        }
      : {}),
    ...(['Stop', 'StopFailure'].includes(hookEventName)
      ? {
          promptId: claudePromptId(value.prompt_id),
          finalMessage: claudeFinalMessage(
            value.last_assistant_message,
            value.last_assistant_message_truncated,
          ),
        }
      : {}),
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
