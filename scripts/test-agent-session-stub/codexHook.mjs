import { appendCodexRecord, createCodexSessionFile } from '../test-agent-session-jsonl.mjs'

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
  const endpoint = process.env.OPENCOVE_CODEX_HOOK_ENDPOINT
  const token = process.env.OPENCOVE_CODEX_HOOK_TOKEN
  if (!endpoint || !token) {
    throw new Error('Codex hook stub did not receive its correlation environment.')
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-opencove-hook-token': token,
    },
    body: JSON.stringify(envelope),
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
