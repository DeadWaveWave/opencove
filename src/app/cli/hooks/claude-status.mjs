#!/usr/bin/env node

const endpoint = process.env.OPENCOVE_CLAUDE_HOOK_ENDPOINT?.trim() ?? ''
const token = process.env.OPENCOVE_CLAUDE_HOOK_TOKEN?.trim() ?? ''

if (endpoint.length === 0 || token.length === 0) {
  process.exit(0)
}

function resolveState(input) {
  const eventName = input.hook_event_name
  const toolName = input.tool_name
  const notificationType = input.notification_type

  if (eventName === 'PermissionRequest') {
    return toolName ? 'waiting' : null
  }
  if (eventName === 'PreToolUse') {
    if (typeof toolName !== 'string' || toolName.length === 0) {
      return null
    }
    return toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode' ? 'waiting' : 'working'
  }
  if (eventName === 'Notification') {
    if (
      notificationType === 'permission_prompt' ||
      notificationType === 'idle_prompt' ||
      notificationType === 'agent_needs_input' ||
      notificationType === 'elicitation_dialog' ||
      notificationType === 'elicitation_url_dialog'
    ) {
      return 'waiting'
    }
    if (
      notificationType === 'elicitation_complete' ||
      notificationType === 'elicitation_response' ||
      notificationType === 'auth_success'
    ) {
      return 'working'
    }
    return null
  }
  if (eventName === 'Stop' || eventName === 'StopFailure' || eventName === 'SessionEnd') {
    return 'done'
  }
  if (
    eventName === 'UserPromptSubmit' ||
    eventName === 'PostToolUse' ||
    eventName === 'PostToolUseFailure' ||
    eventName === 'PermissionDenied'
  ) {
    return 'working'
  }
  return null
}

async function readInput() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(raw)
}

try {
  const input = await readInput()
  const state = resolveState(input)
  if (!state || typeof input.session_id !== 'string' || input.session_id.trim().length === 0) {
    process.exit(0)
  }

  const envelope = {
    version: 1,
    state,
    hookEventName: input.hook_event_name,
    claudeSessionId: input.session_id,
    ...(typeof input.tool_name === 'string' && input.tool_name.length > 0
      ? {
          tool: {
            name: input.tool_name,
            useId:
              typeof input.tool_use_id === 'string' && input.tool_use_id.length > 0
                ? input.tool_use_id
                : null,
            input: input.tool_input ?? null,
          },
        }
      : {}),
  }

  await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-opencove-hook-token': token,
    },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(3_000),
  })
} catch {
  process.exit(0)
}
