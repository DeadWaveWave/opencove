import { createHash } from 'node:crypto'

const EVENT_LABELS: Record<string, string> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PermissionRequest: 'permission_request',
  PostToolUse: 'post_tool_use',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
  Stop: 'stop',
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

export function codexHookEventLabel(eventName: string): string {
  return (
    EVENT_LABELS[eventName] ?? eventName.replaceAll(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase()
  )
}

export function computeCodexHookTrustedHash(input: {
  eventName: string
  command: string
  timeoutSeconds?: number
  matcher?: string
  statusMessage?: string
}): string {
  const eventName = codexHookEventLabel(input.eventName)
  const timeout = Math.max(1, Math.floor(input.timeoutSeconds ?? 600))
  const commandHook = {
    type: 'command',
    command: input.command,
    timeout,
    async: false,
    ...(input.statusMessage ? { statusMessage: input.statusMessage } : {}),
  }
  const identity = {
    event_name: eventName,
    ...(input.matcher && eventName !== 'user_prompt_submit' && eventName !== 'stop'
      ? { matcher: input.matcher }
      : {}),
    hooks: [commandHook],
  }
  const serialized = JSON.stringify(canonicalize(identity))
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`
}

export function computeCodexHookTrustKey(input: {
  sourcePath: string
  eventName: string
  groupIndex?: number
  handlerIndex?: number
}): string {
  return `${input.sourcePath}:${codexHookEventLabel(input.eventName)}:${String(input.groupIndex ?? 0)}:${String(input.handlerIndex ?? 0)}`
}
