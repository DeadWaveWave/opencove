#!/usr/bin/env node

import fs from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  appendCodexRecord,
  createCodexSessionFile,
  runJsonlStdinSubmitDelayedTurnScenario,
} from './test-agent-session-jsonl.mjs'

function sleep(ms) {
  return new Promise(resolveSleep => {
    setTimeout(resolveSleep, ms)
  })
}

function normalizeGeminiProjectDirectoryName(cwd) {
  const name = basename(cwd).trim()
  return name.length > 0 ? name.replace(/[^a-zA-Z0-9._-]/g, '-') : 'workspace'
}

const BRACKETED_PASTE_START = '\u001b[200~'
const BRACKETED_PASTE_END = '\u001b[201~'

function createGeminiTimestamp(timestampMs) {
  return new Date(timestampMs).toISOString()
}

async function ensureGeminiProjectDirectory(cwd) {
  const projectDirectory = join(
    os.homedir(),
    '.gemini',
    'tmp',
    normalizeGeminiProjectDirectoryName(cwd),
  )
  await fs.mkdir(join(projectDirectory, 'chats'), { recursive: true })
  await fs.writeFile(join(projectDirectory, '.project_root'), cwd, 'utf8')
  return projectDirectory
}

function createGeminiSessionFileName(startedAtMs, sessionId) {
  const iso = createGeminiTimestamp(startedAtMs)
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '')
  return `session-${iso}-${sessionId.slice(0, 8)}.json`
}

function createGeminiMessage(type, content, timestampMs) {
  const timestamp = createGeminiTimestamp(timestampMs)
  return {
    id: `${type}-${timestampMs}`,
    timestamp,
    type,
    content,
  }
}

async function writeGeminiSessionFile({
  sessionFilePath,
  sessionId,
  startedAtMs,
  messages,
  summary,
}) {
  const lastUpdated =
    messages.length > 0 && typeof messages[messages.length - 1]?.timestamp === 'string'
      ? messages[messages.length - 1].timestamp
      : createGeminiTimestamp(startedAtMs)

  await fs.writeFile(
    sessionFilePath,
    JSON.stringify(
      {
        sessionId,
        projectHash: 'cove-test-project-hash',
        startTime: createGeminiTimestamp(startedAtMs),
        lastUpdated,
        messages,
        kind: 'main',
        ...(summary ? { summary } : {}),
      },
      null,
      2,
    ),
    'utf8',
  )
}

async function createGeminiSession(cwd) {
  const startedAtMs = Date.now()
  const sessionId = `cove-test-gemini-${startedAtMs}`
  const projectDirectory = await ensureGeminiProjectDirectory(cwd)
  const sessionFilePath = join(
    projectDirectory,
    'chats',
    createGeminiSessionFileName(startedAtMs, sessionId),
  )

  return {
    sessionId,
    startedAtMs,
    sessionFilePath,
  }
}

async function runGeminiUserThenGeminiScenario(cwd) {
  const session = await createGeminiSession(cwd)
  const userTimestampMs = Date.now() + 700
  const replyTimestampMs = userTimestampMs + 1200

  await sleep(700)
  await writeGeminiSessionFile({
    ...session,
    messages: [createGeminiMessage('user', [{ text: 'Summarize release notes' }], userTimestampMs)],
  })

  await sleep(1200)
  await writeGeminiSessionFile({
    ...session,
    messages: [
      createGeminiMessage('user', [{ text: 'Summarize release notes' }], userTimestampMs),
      createGeminiMessage('gemini', 'OK', replyTimestampMs),
    ],
    summary: 'Return OK only.',
  })

  await sleep(20_000)
}

async function runGeminiStdinSubmitThenReplyScenario(cwd) {
  const submittedLine = await new Promise(resolveLine => {
    let buffer = ''
    let settled = false

    const settle = line => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolveLine(line)
    }

    const timer = setTimeout(() => {
      settle(null)
    }, 20_000)

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buffer += chunk
      const newlineIndex = buffer.search(/[\r\n]/)
      if (newlineIndex !== -1) {
        settle(buffer.slice(0, newlineIndex))
      }
    })
    process.stdin.resume()
  })
  if (submittedLine === null) {
    await sleep(20_000)
    return
  }

  const prompt = submittedLine.trim()
  const session = await createGeminiSession(cwd)
  const userTimestampMs = Date.now()
  const replyTimestampMs = userTimestampMs + 1200

  await writeGeminiSessionFile({
    ...session,
    messages: [createGeminiMessage('user', [{ text: prompt }], userTimestampMs)],
  })

  await sleep(1200)
  await writeGeminiSessionFile({
    ...session,
    messages: [
      createGeminiMessage('user', [{ text: prompt }], userTimestampMs),
      createGeminiMessage('gemini', 'OK', replyTimestampMs),
    ],
    summary: 'Return OK only.',
  })

  await sleep(20_000)
}

async function runCodexStandbyNoNewlineScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)

  await sleep(800)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'reasoning',
      summary: [],
    },
  })

  await sleep(1200)
  await appendCodexRecord(
    sessionFilePath,
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [
          {
            type: 'output_text',
            text: 'All set.',
          },
        ],
      },
    },
    { newline: false },
  )

  await sleep(20_000)
}

async function runCodexCommentaryThenFinalScenario(cwd) {
  const sessionFilePath = await createCodexSessionFile(cwd)

  await sleep(700)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'reasoning',
      summary: [],
    },
  })

  await sleep(1200)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [
        {
          type: 'output_text',
          text: 'I am checking the repo before making changes.',
        },
      ],
    },
  })

  await sleep(1200)
  await appendCodexRecord(sessionFilePath, {
    type: 'response_item',
    payload: {
      type: 'function_call',
      call_id: 'call-cove-test-1',
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
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [
          {
            type: 'output_text',
            text: 'Done.',
          },
        ],
      },
    },
    { newline: false },
  )

  await sleep(20_000)
}

function extractBracketedPastePayload(buffer) {
  const startIndex = buffer.indexOf(BRACKETED_PASTE_START)
  if (startIndex === -1) {
    return null
  }

  const contentStartIndex = startIndex + BRACKETED_PASTE_START.length
  const endIndex = buffer.indexOf(BRACKETED_PASTE_END, contentStartIndex)
  if (endIndex === -1) {
    return null
  }

  return buffer.slice(contentStartIndex, endIndex)
}

async function runRawBracketedPasteEchoScenario() {
  process.stdout.write('\u001b[?2004h')

  await new Promise(resolveScenario => {
    let settled = false
    let buffer = ''

    const settle = message => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      process.stdout.write(`${message}\n`)
      process.stdout.write('\u001b[?2004l')
      resolveScenario()
    }

    const timeout = setTimeout(() => {
      settle('[cove-test-paste] timeout')
    }, 8_000)

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true)
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buffer += chunk

      const bracketedPayload = extractBracketedPastePayload(buffer)
      if (typeof bracketedPayload === 'string') {
        settle(`[cove-test-paste] ${bracketedPayload}`)
        return
      }

      if (buffer.includes('\u0016')) {
        settle('[cove-test-paste] ctrl-v')
      }
    })
    process.stdin.resume()
  })

  await sleep(20_000)
}

async function main() {
  const [
    provider = 'codex',
    rawCwd = process.cwd(),
    mode = 'new',
    model = 'default-model',
    scenario = '',
  ] = process.argv.slice(2)
  const cwd = resolve(rawCwd)

  process.stdout.write(`[cove-test-agent] ${provider} ${mode} ${model}\n`)

  if (provider === 'codex' && scenario === 'codex-standby-no-newline') {
    await runCodexStandbyNoNewlineScenario(cwd)
    return
  }

  if (provider === 'codex' && scenario === 'codex-commentary-then-final') {
    await runCodexCommentaryThenFinalScenario(cwd)
    return
  }

  if (
    (provider === 'codex' || provider === 'claude-code') &&
    scenario === 'jsonl-stdin-submit-delayed-turn'
  ) {
    await runJsonlStdinSubmitDelayedTurnScenario(provider, cwd)
    return
  }

  if (scenario === 'raw-bracketed-paste-echo') {
    await runRawBracketedPasteEchoScenario()
    return
  }

  if (provider === 'gemini' && scenario === 'gemini-user-then-gemini') {
    await runGeminiUserThenGeminiScenario(cwd)
    return
  }

  if (provider === 'gemini' && scenario === 'gemini-stdin-submit-then-reply') {
    await runGeminiStdinSubmitThenReplyScenario(cwd)
    return
  }

  await sleep(120_000)
}

await main()
