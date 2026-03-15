import fs from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { AgentProviderId } from '@shared/contracts/dto'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'
import {
  findGeminiResumeSessionId,
  findOpenCodeResumeSessionId,
} from './AgentSessionLocatorProviders'

interface LocateAgentResumeSessionInput {
  provider: AgentProviderId
  cwd: string
  startedAtMs: number
  timeoutMs?: number
}

interface CodexSessionMeta {
  sessionId: string
  cwd: string
  payloadTimestampMs: number | null
  recordTimestampMs: number | null
}

const POLL_INTERVAL_MS = 200
const DEFAULT_TIMEOUT_MS = 2600
const FIRST_LINE_READ_CHUNK_BYTES = 4096
const FIRST_LINE_MAX_BYTES = 64 * 1024
const CODEX_CANDIDATE_WINDOW_MS = 20_000

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

function normalizeSessionIdFromPath(filePath: string): string | null {
  if (extname(filePath) !== '.jsonl') {
    return null
  }

  const name = basename(filePath, '.jsonl').trim()
  return name.length > 0 ? name : null
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

function parseCodexSessionMeta(firstLine: string): CodexSessionMeta | null {
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: unknown
      timestamp?: unknown
      payload?: {
        id?: unknown
        cwd?: unknown
        timestamp?: unknown
      }
    }

    if (parsed.type !== 'session_meta') {
      return null
    }

    const sessionId = typeof parsed.payload?.id === 'string' ? parsed.payload.id.trim() : ''
    const sessionCwd = typeof parsed.payload?.cwd === 'string' ? resolve(parsed.payload.cwd) : null
    const payloadTimestampMs = parseTimestampMs(parsed.payload?.timestamp)
    const recordTimestampMs = parseTimestampMs(parsed.timestamp)

    if (
      sessionId.length === 0 ||
      !sessionCwd ||
      (payloadTimestampMs === null && recordTimestampMs === null)
    ) {
      return null
    }

    return {
      sessionId,
      cwd: sessionCwd,
      payloadTimestampMs,
      recordTimestampMs,
    }
  } catch {
    return null
  }
}

function resolveCodexSessionTimestampMs(meta: CodexSessionMeta, startedAtMs: number): number {
  const candidates = [meta.payloadTimestampMs, meta.recordTimestampMs].filter(
    (value): value is number => typeof value === 'number',
  )

  if (candidates.length === 0) {
    return startedAtMs
  }

  return candidates.sort(
    (left, right) => Math.abs(left - startedAtMs) - Math.abs(right - startedAtMs),
  )[0]
}

async function findClaudeResumeSessionId(cwd: string, startedAtMs: number): Promise<string | null> {
  const claudeProjectsDir = join(resolveHomeDirectory(), '.claude', 'projects')
  const encodedPath = resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, '')
  const projectDir = join(claudeProjectsDir, encodedPath)

  const files = (await listFiles(projectDir)).filter(file => file.endsWith('.jsonl'))
  if (files.length === 0) {
    return null
  }

  const candidates = await Promise.all(
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

  const latest = candidates
    .filter((item): item is { file: string; mtimeMs: number } => item !== null)
    .filter(item => item.mtimeMs >= startedAtMs - 6000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

  if (!latest) {
    return null
  }

  return normalizeSessionIdFromPath(latest.file)
}

async function findCodexResumeSessionId(cwd: string, startedAtMs: number): Promise<string | null> {
  const codexSessionsDir = join(resolveHomeDirectory(), '.codex', 'sessions')
  const resolvedCwd = resolve(cwd)
  const dateCandidates = new Set<string>()
  const now = Date.now()

  for (const timestamp of [
    startedAtMs,
    startedAtMs - 24 * 60 * 60 * 1000,
    now,
    now - 24 * 60 * 60 * 1000,
  ]) {
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

  const matchingSessionIds = new Set<string>()

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const firstLine = await readFirstLine(file)
    if (!firstLine) {
      continue
    }

    const parsed = parseCodexSessionMeta(firstLine)
    if (!parsed || parsed.cwd !== resolvedCwd) {
      continue
    }

    const timestampMs = resolveCodexSessionTimestampMs(parsed, startedAtMs)
    if (Math.abs(timestampMs - startedAtMs) > CODEX_CANDIDATE_WINDOW_MS) {
      continue
    }

    matchingSessionIds.add(parsed.sessionId)
    if (matchingSessionIds.size > 1) {
      return null
    }
  }

  const [sessionId] = [...matchingSessionIds]
  return sessionId ?? null
}

async function tryFindResumeSessionId(
  provider: AgentProviderId,
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  if (provider === 'claude-code') {
    return await findClaudeResumeSessionId(cwd, startedAtMs)
  }

  if (provider === 'codex') {
    return await findCodexResumeSessionId(cwd, startedAtMs)
  }

  if (provider === 'opencode') {
    return await findOpenCodeResumeSessionId(cwd, startedAtMs)
  }

  return await findGeminiResumeSessionId(cwd, startedAtMs)
}

async function pollResumeSessionId(
  provider: AgentProviderId,
  cwd: string,
  startedAtMs: number,
  deadline: number,
): Promise<string | null> {
  const detected = await tryFindResumeSessionId(provider, cwd, startedAtMs)
  if (detected) {
    return detected
  }

  if (Date.now() > deadline) {
    return null
  }

  await wait(POLL_INTERVAL_MS)
  return await pollResumeSessionId(provider, cwd, startedAtMs, deadline)
}

export async function locateAgentResumeSessionId({
  provider,
  cwd,
  startedAtMs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: LocateAgentResumeSessionInput): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  return await pollResumeSessionId(provider, cwd, startedAtMs, deadline)
}
