import fs from 'node:fs/promises'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'

function sleep(ms) {
  return new Promise(resolveSleep => {
    setTimeout(resolveSleep, ms)
  })
}

function toDateDirectoryParts(timestampMs) {
  const date = new Date(timestampMs)
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ]
}

export async function createCodexSessionFile(cwd) {
  const startedAtMs = Date.now()
  const sessionId = `opencove-test-session-${startedAtMs}`
  const [year, month, day] = toDateDirectoryParts(startedAtMs)
  const sessionFilePath = join(
    os.homedir(),
    '.codex',
    'sessions',
    year,
    month,
    day,
    `rollout-${sessionId}.jsonl`,
  )
  const sessionTimestamp = new Date(startedAtMs).toISOString()

  await fs.mkdir(dirname(sessionFilePath), { recursive: true })
  await fs.writeFile(
    sessionFilePath,
    `${JSON.stringify({
      timestamp: sessionTimestamp,
      type: 'session_meta',
      payload: { id: sessionId, cwd, timestamp: sessionTimestamp },
    })}\n`,
    'utf8',
  )

  return sessionFilePath
}

export async function appendCodexRecord(sessionFilePath, record, { newline = true } = {}) {
  const serialized = JSON.stringify(record)
  await fs.appendFile(sessionFilePath, newline ? `${serialized}\n` : serialized, 'utf8')
}

async function createClaudeSessionFile(cwd) {
  const startedAtMs = Date.now()
  const sessionId = `opencove-test-session-${startedAtMs}`
  const sessionFilePath = join(
    os.homedir(),
    '.claude',
    'projects',
    resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, ''),
    `${sessionId}.jsonl`,
  )

  await fs.mkdir(dirname(sessionFilePath), { recursive: true })
  await fs.writeFile(sessionFilePath, '', 'utf8')
  return sessionFilePath
}

async function appendClaudeRecord(sessionFilePath, record, { newline = true } = {}) {
  const serialized = JSON.stringify(record)
  await fs.appendFile(sessionFilePath, newline ? `${serialized}\n` : serialized, 'utf8')
}

export async function runJsonlStdinSubmitDelayedTurnScenario(provider, cwd) {
  await sleep(1200)
  const finalText = 'Done.'

  if (provider === 'claude-code') {
    const sessionFilePath = await createClaudeSessionFile(cwd)
    await appendClaudeRecord(sessionFilePath, {
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', text: 'Checking the workspace first.' }],
        stop_reason: null,
      },
    })

    await sleep(2000)
    await appendClaudeRecord(
      sessionFilePath,
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: finalText }],
          stop_reason: 'end_turn',
        },
      },
      { newline: false },
    )
    await sleep(20_000)
    return
  }

  const sessionFilePath = await createCodexSessionFile(cwd)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: { type: 'reasoning', summary: [] },
  })

  await sleep(2000)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: finalText }],
      },
    },
    { newline: false },
  )

  await sleep(20_000)
}
