import fs from 'node:fs/promises'
import os from 'node:os'
import { basename, join } from 'node:path'
import { sleep } from './sleep.mjs'

function normalizeGeminiProjectDirectoryName(cwd) {
  const name = basename(cwd).trim()
  return name.length > 0 ? name.replace(/[^a-zA-Z0-9._-]/g, '-') : 'workspace'
}

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
        projectHash: 'opencove-test-project-hash',
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
  const sessionId = `opencove-test-gemini-${startedAtMs}`
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

export async function runGeminiUserThenGeminiScenario(cwd) {
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

export async function runGeminiStdinSubmitThenReplyScenario(cwd) {
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
