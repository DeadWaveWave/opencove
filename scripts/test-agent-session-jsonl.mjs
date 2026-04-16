import fs from 'node:fs/promises'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'

const INTERACTIVE_SCENARIO_LIFETIME_MS = 180_000

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

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function findCodexSessionFileById(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return null
  }

  const sessionsRoot = join(os.homedir(), '.codex', 'sessions')
  const targetFileName = `rollout-${sessionId.trim()}.jsonl`

  const visitDirectory = async currentDirectory => {
    let entries
    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true })
    } catch {
      return null
    }

    const matchingFile = entries.find(entry => entry.isFile() && entry.name === targetFileName)
    if (matchingFile) {
      return join(currentDirectory, matchingFile.name)
    }

    const childDirectories = entries
      .filter(entry => entry.isDirectory())
      .map(entry => join(currentDirectory, entry.name))

    const nestedResults = await Promise.all(childDirectories.map(visitDirectory))
    return nestedResults.find(result => typeof result === 'string') ?? null
  }

  return await visitDirectory(sessionsRoot)
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

function resolveClaudeProjectDirectory(cwd) {
  return join(
    os.homedir(),
    '.claude',
    'projects',
    resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, ''),
  )
}

async function findClaudeSessionFile(cwd, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return null
  }

  const candidatePath = join(resolveClaudeProjectDirectory(cwd), `${sessionId.trim()}.jsonl`)
  return (await pathExists(candidatePath)) ? candidatePath : null
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
    await sleep(INTERACTIVE_SCENARIO_LIFETIME_MS)
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

  await sleep(INTERACTIVE_SCENARIO_LIFETIME_MS)
}

async function resolveScenarioSessionFile({ provider, cwd, mode, resumeSessionId }) {
  if (
    mode === 'resume' &&
    typeof resumeSessionId === 'string' &&
    resumeSessionId.trim().length > 0
  ) {
    if (provider === 'claude-code') {
      const existingClaudeSession = await findClaudeSessionFile(cwd, resumeSessionId)
      if (existingClaudeSession) {
        return {
          sessionFilePath: existingClaudeSession,
          createdNewSession: false,
        }
      }
    } else {
      const existingCodexSession = await findCodexSessionFileById(resumeSessionId)
      if (existingCodexSession) {
        return {
          sessionFilePath: existingCodexSession,
          createdNewSession: false,
        }
      }
    }
  }

  const sessionFilePath =
    provider === 'claude-code'
      ? await createClaudeSessionFile(cwd)
      : await createCodexSessionFile(cwd)

  return {
    sessionFilePath,
    createdNewSession: true,
  }
}

export async function runJsonlStdinSubmitDrivenTurnScenario(
  provider,
  cwd,
  mode = 'new',
  resumeSessionId = null,
) {
  let turnCounter = 0
  let appendTurnQueue = Promise.resolve()

  const scheduleTurn = appendTurn => {
    appendTurnQueue = appendTurnQueue.then(async () => {
      turnCounter += 1
      await sleep(350)
      await appendTurn(turnCounter)
    })
  }

  if (provider === 'claude-code') {
    const { sessionFilePath, createdNewSession } = await resolveScenarioSessionFile({
      provider,
      cwd,
      mode,
      resumeSessionId,
    })

    if (createdNewSession) {
      await sleep(1200)
      await appendClaudeRecord(sessionFilePath, {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Ready.' }],
          stop_reason: 'end_turn',
        },
      })
    }

    process.stdin.on('data', chunk => {
      const text = Buffer.from(chunk).toString('utf8')
      if (!/[\r\n]/.test(text)) {
        return
      }

      scheduleTurn(async currentTurn => {
        await appendClaudeRecord(sessionFilePath, {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: `Done ${currentTurn}.` }],
            stop_reason: 'end_turn',
          },
        })
      })
    })

    await sleep(INTERACTIVE_SCENARIO_LIFETIME_MS)
    return
  }

  const { sessionFilePath, createdNewSession } = await resolveScenarioSessionFile({
    provider,
    cwd,
    mode,
    resumeSessionId,
  })

  if (createdNewSession) {
    await sleep(1200)
    await appendCodexRecord(sessionFilePath, {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: 'Ready.' }],
      },
    })
  }

  process.stdin.on('data', chunk => {
    const text = Buffer.from(chunk).toString('utf8')
    if (!/[\r\n]/.test(text)) {
      return
    }

    scheduleTurn(async currentTurn => {
      await appendCodexRecord(sessionFilePath, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: `Done ${currentTurn}.` }],
        },
      })
    })
  })

  await sleep(INTERACTIVE_SCENARIO_LIFETIME_MS)
}
