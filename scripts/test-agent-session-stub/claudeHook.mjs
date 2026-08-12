const SIGNALS = {
  '<test-hook-tool>': {
    version: 1,
    state: 'working',
    hookEventName: 'PreToolUse',
    claudeSessionId: 'claude-hook-e2e',
    tool: { name: 'Bash', useId: 'tool-ordinary', input: { command: 'true' } },
  },
  '<test-hook-waiting>': {
    version: 1,
    state: 'waiting',
    hookEventName: 'PermissionRequest',
    claudeSessionId: 'claude-hook-e2e',
    tool: { name: 'Bash', useId: 'tool-waiting', input: { command: 'pnpm test' } },
  },
  '<test-hook-done>': {
    version: 1,
    state: 'done',
    hookEventName: 'Stop',
    claudeSessionId: 'claude-hook-e2e',
  },
}

import { appendClaudeRecord, createClaudeSessionFile } from '../test-agent-session-jsonl.mjs'

async function postHook(envelope) {
  const endpoint = process.env.OPENCOVE_CLAUDE_HOOK_ENDPOINT
  const token = process.env.OPENCOVE_CLAUDE_HOOK_TOKEN
  if (!endpoint || !token) {
    throw new Error('Claude hook stub did not receive its correlation environment.')
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
    throw new Error(`Claude hook stub POST failed with ${response.status}.`)
  }
}

async function runClaudeHookScenario(cwd, { sessionFileWarmStandby }) {
  const sessionFilePath = sessionFileWarmStandby ? await createClaudeSessionFile(cwd) : null
  if (sessionFilePath) {
    await appendClaudeRecord(sessionFilePath, {
      type: 'user',
      message: { content: [{ type: 'text', text: 'Begin arbitration test.' }] },
    })
  }
  await postHook({
    version: 1,
    state: 'working',
    hookEventName: 'UserPromptSubmit',
    claudeSessionId: 'claude-hook-e2e',
  })
  process.stdout.write('[opencove-test-hook] ready\n')

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
        if (sessionFilePath && input.endsWith('<test-session-standby>')) {
          input = ''
          operation = operation.then(async () => {
            await appendClaudeRecord(sessionFilePath, {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: 'Conflicting fallback standby.' }],
                stop_reason: 'end_turn',
              },
            })
            process.stdout.write('[opencove-test-hook] session-standby\n')
          })
          continue
        }
        const matched = Object.entries(SIGNALS).find(([signal]) => input.endsWith(signal))
        if (matched) {
          input = ''
          operation = operation.then(async () => {
            await postHook(matched[1])
            process.stdout.write(`[opencove-test-hook] ${matched[1].state}\n`)
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

export async function runClaudeHookLifecycleScenario(cwd) {
  await runClaudeHookScenario(cwd, { sessionFileWarmStandby: false })
}

export async function runClaudeHookArbitrationScenario(cwd) {
  await runClaudeHookScenario(cwd, { sessionFileWarmStandby: true })
}

export async function runClaudeHookFallbackScenario(cwd) {
  const sessionFilePath = await createClaudeSessionFile(cwd)
  await appendClaudeRecord(sessionFilePath, {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'Fallback ready.' }],
      stop_reason: 'end_turn',
    },
  })
  process.stdout.write('[opencove-test-hook-fallback] ready\n')
  await new Promise(resolveRun => {
    process.stdin.on('data', chunk => {
      if (Buffer.from(chunk).includes(0x03)) {
        resolveRun()
      }
    })
    process.stdin.resume()
  })
}
