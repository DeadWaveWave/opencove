import path from 'node:path'

function resolveProviderSessionId(provider, sessionFilePath) {
  const fileName = path.basename(sessionFilePath, '.jsonl')
  return provider === 'codex' ? fileName.replace(/^rollout-/, '') : fileName
}

async function reportInjectedTerminalHook(provider, cwd, sessionFilePath, hookEventName) {
  const isClaude = provider === 'claude-code'
  const endpoint =
    process.env[isClaude ? 'OPENCOVE_CLAUDE_HOOK_ENDPOINT' : 'OPENCOVE_CODEX_HOOK_ENDPOINT']
  const token = process.env[isClaude ? 'OPENCOVE_CLAUDE_HOOK_TOKEN' : 'OPENCOVE_CODEX_HOOK_TOKEN']
  if (!endpoint || !token) {
    return null
  }

  const sessionId = resolveProviderSessionId(provider, sessionFilePath)
  const body = isClaude
    ? {
        session_id: sessionId,
        transcript_path: sessionFilePath,
        cwd,
        hook_event_name: hookEventName,
      }
    : {
        session_id: sessionId,
        transcript_path: sessionFilePath,
        cwd,
        hook_event_name: hookEventName,
        model: 'default-model',
      }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-opencove-hook-token': token,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Terminal shim SessionStart hook POST failed with ${response.status}.`)
  }
  return sessionId
}

export async function reportInjectedTerminalSessionStart(provider, cwd, sessionFilePath) {
  return await reportInjectedTerminalHook(provider, cwd, sessionFilePath, 'SessionStart')
}

export async function reportInjectedTerminalTurnCompleted(provider, cwd, sessionFilePath) {
  return await reportInjectedTerminalHook(provider, cwd, sessionFilePath, 'Stop')
}
