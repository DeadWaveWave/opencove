import { appendCodexRecord, createCodexSessionFile } from '../test-agent-session-jsonl.mjs'
import { readFile } from 'node:fs/promises'

const SIGNALS = {
  '<test-codex-hook-working>': {
    version: 1,
    state: 'working',
    hookEventName: 'UserPromptSubmit',
    codexSessionId: 'codex-hook-e2e',
  },
  '<test-codex-hook-waiting>': {
    version: 1,
    state: 'waiting',
    hookEventName: 'PermissionRequest',
    codexSessionId: 'codex-hook-e2e',
    tool: { name: 'Bash', useId: 'tool-waiting', input: { command: 'pnpm test' } },
  },
  '<test-codex-hook-done>': {
    version: 1,
    state: 'done',
    hookEventName: 'Stop',
    codexSessionId: 'codex-hook-e2e',
  },
}

async function postHook(envelope) {
  const endpointPath = process.env.OPENCOVE_AGENT_HOOK_ENDPOINT
  const paneKey = process.env.OPENCOVE_PANE_KEY
  if (!endpointPath || !paneKey) {
    throw new Error('Codex hook stub did not receive its correlation environment.')
  }
  const coordinates = Object.fromEntries(
    (await readFile(endpointPath, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => line.replace(/^set /, '').split(/=(.*)/s).slice(0, 2)),
  )
  const port = coordinates.OPENCOVE_AGENT_HOOK_PORT
  const token = coordinates.OPENCOVE_AGENT_HOOK_TOKEN
  const form = new URLSearchParams({
    paneKey,
    tabId: process.env.OPENCOVE_TAB_ID ?? '',
    worktreeId: process.env.OPENCOVE_WORKTREE_ID ?? '',
    env: coordinates.OPENCOVE_AGENT_HOOK_ENV ?? '',
    version: coordinates.OPENCOVE_AGENT_HOOK_VERSION ?? '',
    payload: JSON.stringify({
      session_id: envelope.codexSessionId,
      transcript_path: null,
      cwd: process.cwd(),
      hook_event_name: envelope.hookEventName,
      model: 'test-model',
      ...(envelope.tool
        ? {
            tool_name: envelope.tool.name,
            tool_use_id: envelope.tool.useId,
            tool_input: envelope.tool.input,
          }
        : {}),
    }),
  })
  const response = await fetch(`http://127.0.0.1:${port}/hook/codex`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-opencove-agent-hook-token': token,
    },
    body: form,
  })
  if (!response.ok) {
    throw new Error(`Codex hook stub POST failed with ${response.status}.`)
  }
}

export async function runCodexHookLifecycleScenario() {
  process.stdout.write('[opencove-test-codex-hook] ready\n')
  await new Promise((resolveRun, reject) => {
    let input = ''
    let operation = Promise.resolve()
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.pause()
    }
    const onData = chunk => {
      for (const byte of Buffer.from(chunk)) {
        if (byte === 0x03) {
          cleanup()
          void operation.then(resolveRun, reject)
          return
        }
        input += String.fromCharCode(byte)
        const matched = Object.entries(SIGNALS).find(([signal]) => input.endsWith(signal))
        if (matched) {
          input = ''
          operation = operation.then(async () => {
            await postHook(matched[1])
            process.stdout.write(`[opencove-test-codex-hook] ${matched[1].state}\n`)
          })
        } else if (input.length > 64) {
          input = input.slice(-64)
        }
      }
    }
    process.stdin.on('data', onData)
    process.stdin.resume()
  })
}

export async function runCodexHookFallbackScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)
  await appendCodexRecord(sessionFilePath, {
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: 'opencove-test-codex-hook-fallback',
      last_agent_message: 'Fallback ready.',
    },
  })
  process.stdout.write('[opencove-test-codex-hook-fallback] ready\n')
  await new Promise(resolveRun => {
    process.stdin.on('data', chunk => {
      if (Buffer.from(chunk).includes(0x03)) {
        resolveRun()
      }
    })
    process.stdin.resume()
  })
}
