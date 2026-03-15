import fs from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { AgentProviderId } from '@shared/contracts/dto'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'

interface ResolveSessionFilePathInput {
  provider: AgentProviderId
  cwd: string
  sessionId: string
  startedAtMs: number
  timeoutMs?: number
}

const POLL_INTERVAL_MS = 200
const DEFAULT_TIMEOUT_MS = 2600
const FIRST_LINE_READ_CHUNK_BYTES = 4096
const FIRST_LINE_MAX_BYTES = 64 * 1024

function toDateDirectoryParts(timestampMs: number): [string, string, string] {
  const date = new Date(timestampMs)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return [year, month, day]
}

function wait(durationMs: number): Promise<void> {
  return new Promise(resolveWait => {
    setTimeout(resolveWait, durationMs)
  })
}

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

async function readFirstLine(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const decoder = new StringDecoder('utf8')
    const buffer = Buffer.allocUnsafe(FIRST_LINE_READ_CHUNK_BYTES)
    let bytesReadTotal = 0
    let remainder = ''

    while (bytesReadTotal < FIRST_LINE_MAX_BYTES) {
      const bytesToRead = Math.min(buffer.length, FIRST_LINE_MAX_BYTES - bytesReadTotal)
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, null)
      if (bytesRead <= 0) {
        break
      }

      bytesReadTotal += bytesRead

      const textChunk = decoder.write(buffer.subarray(0, bytesRead))
      if (textChunk.length === 0) {
        continue
      }

      const merged = `${remainder}${textChunk}`
      const newlineIndex = merged.indexOf('\n')
      if (newlineIndex !== -1) {
        const line = merged.slice(0, newlineIndex).trim()
        return line.length > 0 ? line : null
      }

      remainder = merged
    }

    if (bytesReadTotal >= FIRST_LINE_MAX_BYTES) {
      return null
    }

    const finalLine = `${remainder}${decoder.end()}`.trim()
    return finalLine.length > 0 ? finalLine : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function resolveClaudeSessionFilePath(cwd: string, sessionId: string): string {
  const claudeProjectsDir = join(resolveHomeDirectory(), '.claude', 'projects')
  const encodedPath = resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, '')
  return join(claudeProjectsDir, encodedPath, `${sessionId}.jsonl`)
}

async function ensureFileExists(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() ? filePath : null
  } catch {
    return null
  }
}

async function findCodexSessionFilePath(
  cwd: string,
  sessionId: string,
  startedAtMs: number,
): Promise<string | null> {
  const codexSessionsDir = join(resolveHomeDirectory(), '.codex', 'sessions')
  const resolvedCwd = resolve(cwd)

  const dateCandidates = new Set<string>()
  const now = Date.now()
  const timestamps = [startedAtMs, now, now - 24 * 60 * 60 * 1000]

  for (const timestamp of timestamps) {
    const [year, month, day] = toDateDirectoryParts(timestamp)
    dateCandidates.add(join(codexSessionsDir, year, month, day))
  }

  const files = (
    await Promise.all(
      [...dateCandidates].map(async directory => {
        const directoryFiles = await listFiles(directory)
        return directoryFiles.filter(file => basename(file).startsWith('rollout-'))
      }),
    )
  ).flat()

  if (files.length === 0) {
    return null
  }

  const candidates = (
    await Promise.all(
      files.map(async file => {
        try {
          const stats = await fs.stat(file)
          return {
            file,
            mtimeMs: stats.mtimeMs,
          }
        } catch {
          return null
        }
      }),
    )
  )
    .filter((item): item is { file: string; mtimeMs: number } => item !== null)
    .filter(item => item.mtimeMs >= startedAtMs - 60_000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const firstLine = await readFirstLine(candidate.file)
    if (!firstLine) {
      continue
    }

    try {
      const parsed = JSON.parse(firstLine) as {
        payload?: {
          id?: unknown
          cwd?: unknown
        }
      }

      const detectedSessionId =
        typeof parsed.payload?.id === 'string' ? parsed.payload.id.trim() : null
      const sessionCwd =
        typeof parsed.payload?.cwd === 'string' ? resolve(parsed.payload.cwd) : null

      if (!detectedSessionId || detectedSessionId !== sessionId || sessionCwd !== resolvedCwd) {
        continue
      }

      return candidate.file
    } catch {
      continue
    }
  }

  return null
}

async function findGeminiSessionFilePath(cwd: string, sessionId: string): Promise<string | null> {
  const geminiTmpDir = join(resolveHomeDirectory(), '.gemini', 'tmp')
  const resolvedCwd = resolve(cwd)
  const projectDirectories = await listDirectories(geminiTmpDir)

  for (const projectDirectory of projectDirectories) {
    // eslint-disable-next-line no-await-in-loop
    const projectRoot = await fs
      .readFile(join(projectDirectory, '.project_root'), 'utf8')
      .then(contents => contents.trim())
      .catch(() => null)

    if (projectRoot !== resolvedCwd) {
      continue
    }

    // eslint-disable-next-line no-await-in-loop
    const chatFiles = (await listFiles(join(projectDirectory, 'chats'))).filter(file => {
      return file.endsWith('.json') && basename(file).startsWith('session-')
    })

    for (const chatFile of chatFiles) {
      // eslint-disable-next-line no-await-in-loop
      const contents = await fs.readFile(chatFile, 'utf8').catch(() => null)
      if (!contents) {
        continue
      }

      try {
        const parsed = JSON.parse(contents) as { sessionId?: unknown }
        const detectedSessionId =
          typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : null
        if (detectedSessionId === sessionId) {
          return chatFile
        }
      } catch {
        continue
      }
    }
  }

  return null
}

async function tryResolveSessionFilePath(
  provider: AgentProviderId,
  cwd: string,
  sessionId: string,
  startedAtMs: number,
): Promise<string | null> {
  if (provider === 'claude-code') {
    const resolvedPath = resolveClaudeSessionFilePath(cwd, sessionId)
    return await ensureFileExists(resolvedPath)
  }

  if (provider === 'codex') {
    return await findCodexSessionFilePath(cwd, sessionId, startedAtMs)
  }

  if (provider === 'gemini') {
    return await findGeminiSessionFilePath(cwd, sessionId)
  }

  return null
}

async function pollSessionFilePath(
  provider: AgentProviderId,
  cwd: string,
  sessionId: string,
  startedAtMs: number,
  deadline: number,
): Promise<string | null> {
  const resolvedPath = await tryResolveSessionFilePath(provider, cwd, sessionId, startedAtMs)
  if (resolvedPath) {
    return resolvedPath
  }

  if (Date.now() > deadline) {
    return null
  }

  await wait(POLL_INTERVAL_MS)
  return await pollSessionFilePath(provider, cwd, sessionId, startedAtMs, deadline)
}

export async function resolveSessionFilePath({
  provider,
  cwd,
  sessionId,
  startedAtMs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ResolveSessionFilePathInput): Promise<string | null> {
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId.length === 0) {
    return null
  }

  const deadline = Date.now() + timeoutMs
  return await pollSessionFilePath(provider, cwd, normalizedSessionId, startedAtMs, deadline)
}
