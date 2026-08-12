import {
  appendCodexRecord,
  appendClaudeRecord,
  createClaudeSessionFile,
  createCodexSessionFile,
  runJsonlStdinSubmitDelayedTurnScenario,
  runJsonlStdinSubmitDrivenTurnScenario,
} from '../test-agent-session-jsonl.mjs'
import { runRawClickRedrawAfterClickScenario } from './raw.mjs'
import { sleep } from './sleep.mjs'

const IDLE_SCENARIO_LIFETIME_MS = 180_000

export async function runCodexStandbyNoNewlineScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)

  await sleep(800)
  await appendCodexRecord(sessionFilePath, {
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: 'opencove-test-turn-1',
      model_context_window: 128_000,
      collaboration_mode_kind: 'default',
    },
  })

  await sleep(1200)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'opencove-test-turn-1',
        last_agent_message: 'All set.',
      },
    },
    { newline: false },
  )

  await sleep(IDLE_SCENARIO_LIFETIME_MS)
}

export async function runCodexStandbyOnlyScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)

  await sleep(1200)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'opencove-test-turn-1',
        last_agent_message: 'All set.',
      },
    },
    { newline: false },
  )

  await sleep(IDLE_SCENARIO_LIFETIME_MS)
}

export async function runCodexOverlayLifecycleScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)
  process.stdout.write('\u001b[?1049h[opencove-test-overlay] ready\n')

  await appendCodexRecord(sessionFilePath, {
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: 'opencove-test-overlay-turn-1',
      model_context_window: 128_000,
      collaboration_mode_kind: 'default',
    },
  })

  await sleep(2_500)
  await appendCodexRecord(sessionFilePath, {
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      turn_id: 'opencove-test-overlay-turn-1',
      last_agent_message: 'Overlay ready.',
    },
  })

  await new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      process.stdin.off('data', handleData)
      process.off('SIGINT', finish)
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false)
      }
      process.stdin.pause()
      process.stdout.write('\u001b[?1049l[opencove-test-overlay] exited\n')
      resolve()
    }
    const handleData = chunk => {
      if (Buffer.from(chunk).includes(3)) {
        finish()
      }
    }

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true)
    }
    process.stdin.on('data', handleData)
    process.stdin.resume()
    process.on('SIGINT', finish)
  })
}

export async function runJsonlOverlayLifecycleScenario(provider, cwd) {
  const isClaude = provider === 'claude-code'
  const sessionFilePath = isClaude
    ? await createClaudeSessionFile(cwd)
    : await createCodexSessionFile(cwd)
  process.stdout.write(`\u001b[?1049h[opencove-test-overlay] ${provider} ready\n`)

  if (isClaude) {
    await appendClaudeRecord(sessionFilePath, {
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', text: 'Working.' }],
        stop_reason: null,
      },
    })
    await sleep(2_500)
    await appendClaudeRecord(sessionFilePath, {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Overlay ready.' }],
        stop_reason: 'end_turn',
      },
    })
  } else {
    await appendCodexRecord(sessionFilePath, {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: 'opencove-test-overlay-turn-1',
        model_context_window: 128_000,
        collaboration_mode_kind: 'default',
      },
    })
    await sleep(2_500)
    await appendCodexRecord(sessionFilePath, {
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'opencove-test-overlay-turn-1',
        last_agent_message: 'Overlay ready.',
      },
    })
  }

  await new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      process.stdin.off('data', handleData)
      process.off('SIGINT', finish)
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false)
      }
      process.stdin.pause()
      process.stdout.write(`\u001b[?1049l[opencove-test-overlay] ${provider} exited\n`)
      resolve()
    }
    const handleData = chunk => {
      if (Buffer.from(chunk).includes(3)) {
        finish()
      }
    }

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true)
    }
    process.stdin.on('data', handleData)
    process.stdin.resume()
    process.on('SIGINT', finish)
  })
}

export async function runCodexCommentaryThenFinalScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)

  await sleep(700)
  await appendCodexRecord(sessionFilePath, {
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: 'opencove-test-turn-1',
      model_context_window: 128_000,
      collaboration_mode_kind: 'default',
    },
  })

  await sleep(1200)
  await appendCodexRecord(sessionFilePath, {
    type: 'event_msg',
    payload: {
      type: 'agent_reasoning',
      text: 'I am checking the repo before making changes.',
    },
  })

  await sleep(1200)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'function_call',
      call_id: 'call-opencove-test-1',
      name: 'exec_command',
      arguments: '{"cmd":"pwd"}',
    },
  })

  // Leave a larger observation window between commentary/tool-call activity
  // and the final answer so CI timing jitter does not race the status assertion.
  await sleep(4500)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'opencove-test-turn-1',
        last_agent_message: 'Done.',
      },
    },
    { newline: false },
  )

  await sleep(IDLE_SCENARIO_LIFETIME_MS)
}

export async function runCodexClickRedrawAfterClickScenario(cwd) {
  await createCodexSessionFile(cwd)
  await runRawClickRedrawAfterClickScenario()
}

function normalizeSubmittedPrompt(rawValue) {
  let normalized = ''

  for (let index = 0; index < rawValue.length; index += 1) {
    const characterCode = rawValue.charCodeAt(index)
    if (characterCode === 27 && rawValue[index + 1] === '[') {
      index += 2
      while (index < rawValue.length) {
        const sequenceCode = rawValue.charCodeAt(index)
        if (sequenceCode >= 64 && sequenceCode <= 126) {
          break
        }
        index += 1
      }
      continue
    }

    if (characterCode < 32 || characterCode === 127) {
      continue
    }

    normalized += rawValue[index]
  }

  return normalized.trim()
}

export async function runCodexTitleFromFirstInputScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)
  let pendingInput = ''
  let capturedFirstPrompt = false

  process.stdin.on('data', chunk => {
    if (capturedFirstPrompt) {
      return
    }

    pendingInput += Buffer.from(chunk).toString('utf8')
    const submitIndex = pendingInput.search(/[\r\n]/)
    if (submitIndex === -1) {
      return
    }

    const prompt = normalizeSubmittedPrompt(pendingInput.slice(0, submitIndex))
    pendingInput = pendingInput.slice(submitIndex + 1)
    if (prompt.length === 0) {
      return
    }

    capturedFirstPrompt = true
    void (async () => {
      await appendCodexRecord(sessionFilePath, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      })
      await appendCodexRecord(sessionFilePath, {
        type: 'event_msg',
        payload: {
          type: 'task_started',
          turn_id: 'opencove-test-title-turn-1',
          model_context_window: 128_000,
          collaboration_mode_kind: 'default',
        },
      })
      await sleep(50)
      await appendCodexRecord(sessionFilePath, {
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'opencove-test-title-turn-1',
          last_agent_message: 'Done.',
        },
      })
    })()
  })

  await sleep(IDLE_SCENARIO_LIFETIME_MS)
}

export { runJsonlStdinSubmitDelayedTurnScenario, runJsonlStdinSubmitDrivenTurnScenario }
