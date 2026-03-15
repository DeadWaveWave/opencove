import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import { basename, join, resolve } from 'node:path'
import { resolveAgentCliInvocation } from './AgentCliInvocation'

interface GeminiSessionMeta {
  sessionId: string
  startedAtMs: number | null
  updatedAtMs: number | null
  lastRelevantMessageAtMs: number | null
  lastRelevantMessageType: 'user' | 'gemini' | null
}

interface OpenCodeSessionMeta {
  sessionId: string
  directory: string
  createdAtMs: number | null
}

const GEMINI_CANDIDATE_WINDOW_MS = 20_000
const OPENCODE_CANDIDATE_WINDOW_MS = 20_000
const CLI_TIMEOUT_MS = 1_500
const CLI_MAX_BUFFER_BYTES = 8 * 1024 * 1024

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries.filter(entry => entry.isFile()).map(entry => join(directory, entry.name))
  } catch {
    return []
  }
}

async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => join(directory, entry.name))
  } catch {
    return []
  }
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) ? timestampMs : null
}

async function executeCliCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const invocation = await resolveAgentCliInvocation({ command, args })

    return await new Promise((resolveOutput, reject) => {
      execFile(
        invocation.command,
        invocation.args,
        {
          cwd,
          env: process.env,
          encoding: 'utf8',
          windowsHide: true,
          timeout: CLI_TIMEOUT_MS,
          maxBuffer: CLI_MAX_BUFFER_BYTES,
        },
        (error, stdout) => {
          if (error) {
            reject(error)
            return
          }

          resolveOutput(typeof stdout === 'string' ? stdout : stdout.toString('utf8'))
        },
      )
    })
  } catch {
    return null
  }
}

function resolveLastGeminiRelevantMessage(
  messages: unknown,
): { type: 'user' | 'gemini'; timestampMs: number | null } | null {
  if (!Array.isArray(messages)) {
    return null
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== 'object' || !('type' in message)) {
      continue
    }

    if (message.type !== 'user' && message.type !== 'gemini') {
      continue
    }

    return {
      type: message.type,
      timestampMs: 'timestamp' in message ? parseTimestampMs(message.timestamp) : null,
    }
  }

  return null
}

function parseGeminiSessionMeta(rawContents: string): GeminiSessionMeta | null {
  try {
    const parsed = JSON.parse(rawContents) as {
      sessionId?: unknown
      startTime?: unknown
      lastUpdated?: unknown
      messages?: unknown
    }

    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : ''
    if (sessionId.length === 0) {
      return null
    }

    const lastRelevantMessage = resolveLastGeminiRelevantMessage(parsed.messages)

    return {
      sessionId,
      startedAtMs: parseTimestampMs(parsed.startTime),
      updatedAtMs: parseTimestampMs(parsed.lastUpdated),
      lastRelevantMessageAtMs: lastRelevantMessage?.timestampMs ?? null,
      lastRelevantMessageType: lastRelevantMessage?.type ?? null,
    }
  } catch {
    return null
  }
}

function resolveGeminiSessionTimestampMs(meta: GeminiSessionMeta, startedAtMs: number): number {
  const candidates = [meta.lastRelevantMessageAtMs, meta.startedAtMs, meta.updatedAtMs].filter(
    (value): value is number => typeof value === 'number',
  )

  if (candidates.length === 0) {
    return startedAtMs
  }

  return candidates.sort(
    (left, right) => Math.abs(left - startedAtMs) - Math.abs(right - startedAtMs),
  )[0]
}

export async function findGeminiResumeSessionId(
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  const geminiTmpDir = join(os.homedir(), '.gemini', 'tmp')
  const resolvedCwd = resolve(cwd)
  const projectDirectories = await listDirectories(geminiTmpDir)
  const matchingProjectDirectories = (
    await Promise.all(
      projectDirectories.map(async projectDirectory => {
        const projectRoot = await fs
          .readFile(join(projectDirectory, '.project_root'), 'utf8')
          .then(contents => contents.trim())
          .catch(() => null)

        return projectRoot === resolvedCwd ? projectDirectory : null
      }),
    )
  ).filter((projectDirectory): projectDirectory is string => projectDirectory !== null)

  const candidateSessionIds = (
    await Promise.all(
      matchingProjectDirectories.map(async projectDirectory => {
        const chatFiles = (await listFiles(join(projectDirectory, 'chats'))).filter(file => {
          return file.endsWith('.json') && basename(file).startsWith('session-')
        })

        return await Promise.all(
          chatFiles.map(async chatFile => {
            const contents = await fs.readFile(chatFile, 'utf8').catch(() => null)
            if (!contents) {
              return null
            }

            const parsed = parseGeminiSessionMeta(contents)
            if (!parsed) {
              return null
            }

            if (parsed.lastRelevantMessageType === null) {
              return null
            }

            const timestampMs = resolveGeminiSessionTimestampMs(parsed, startedAtMs)
            if (Math.abs(timestampMs - startedAtMs) > GEMINI_CANDIDATE_WINDOW_MS) {
              return null
            }

            return parsed.sessionId
          }),
        )
      }),
    )
  )
    .flat()
    .filter((sessionId): sessionId is string => sessionId !== null)

  const matchingSessionIds = new Set(candidateSessionIds)
  if (matchingSessionIds.size > 1) {
    return null
  }

  const [sessionId] = candidateSessionIds
  return sessionId ?? null
}

function parseOpenCodeSessionList(rawOutput: string): OpenCodeSessionMeta[] {
  try {
    const parsed = JSON.parse(rawOutput) as Array<{
      id?: unknown
      directory?: unknown
      created?: unknown
    }>

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map(item => {
        const sessionId = typeof item.id === 'string' ? item.id.trim() : ''
        const directory = typeof item.directory === 'string' ? resolve(item.directory) : null

        if (sessionId.length === 0 || !directory) {
          return null
        }

        return {
          sessionId,
          directory,
          createdAtMs: parseTimestampMs(item.created),
        }
      })
      .filter((item): item is OpenCodeSessionMeta => item !== null)
  } catch {
    return []
  }
}

export async function findOpenCodeResumeSessionId(
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  const resolvedCwd = resolve(cwd)
  const rawOutput = await executeCliCommand(
    'opencode',
    ['session', 'list', '--format', 'json', '-n', '12'],
    resolvedCwd,
  )

  if (!rawOutput) {
    return null
  }

  const matchingSessionIds = new Set<string>()

  for (const session of parseOpenCodeSessionList(rawOutput)) {
    if (session.directory !== resolvedCwd || session.createdAtMs === null) {
      continue
    }

    if (Math.abs(session.createdAtMs - startedAtMs) > OPENCODE_CANDIDATE_WINDOW_MS) {
      continue
    }

    matchingSessionIds.add(session.sessionId)
    if (matchingSessionIds.size > 1) {
      return null
    }
  }

  const [sessionId] = [...matchingSessionIds]
  return sessionId ?? null
}
