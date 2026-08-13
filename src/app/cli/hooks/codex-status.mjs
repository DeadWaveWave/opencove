#!/usr/bin/env node

const endpoint = process.env.OPENCOVE_CODEX_HOOK_ENDPOINT?.trim() ?? ''
const token = process.env.OPENCOVE_CODEX_HOOK_TOKEN?.trim() ?? ''

if (endpoint.length === 0 || token.length === 0) {
  process.exit(0)
}

const WAITING_EVENTS = new Set(['PermissionRequest'])
const DONE_EVENTS = new Set(['Stop', 'SessionEnd'])
const WORKING_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
])

function resolveState(eventName) {
  if (WAITING_EVENTS.has(eventName)) {
    return 'waiting'
  }
  if (DONE_EVENTS.has(eventName)) {
    return 'done'
  }
  return WORKING_EVENTS.has(eventName) ? 'working' : null
}

async function readInput() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

try {
  const input = await readInput()
  const state = resolveState(input.hook_event_name)
  if (
    !state ||
    typeof input.session_id !== 'string' ||
    input.session_id.trim().length === 0 ||
    typeof input.cwd !== 'string' ||
    input.cwd.trim().length === 0
  ) {
    process.exit(0)
  }

  const envelope = {
    version: 1,
    state,
    hookEventName: input.hook_event_name,
    codexSessionId: input.session_id,
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
