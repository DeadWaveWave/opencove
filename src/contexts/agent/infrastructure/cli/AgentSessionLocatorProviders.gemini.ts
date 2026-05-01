import fs from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { resolveHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'
import { normalizeAgentProjectRootPath } from '../AgentProjectRootPath'
import {
  listDirectories,
  listFiles,
  parseTimestampMs,
  wait,
} from './AgentSessionLocatorProviders.utils'

interface GeminiSessionMeta {
  sessionId: string
  filePath: string
  startedAtMs: number | null
  updatedAtMs: number | null
  lastRelevantMessageAtMs: number | null
  lastRelevantMessageType: 'user' | 'gemini' | null
}

interface GeminiSessionCandidate extends GeminiSessionMeta {
  discoverySignature: string
}

interface GeminiSessionDiscoveryCursorEntry {
  signature: string
  hadRelevantTurn: boolean
}

export interface GeminiSessionDiscoveryCursor {
  entriesByFilePath: Record<string, GeminiSessionDiscoveryCursorEntry>
}

interface FindGeminiResumeSessionIdOptions {
  discoveryCursor?: GeminiSessionDiscoveryCursor | null
}

const GEMINI_CANDIDATE_WINDOW_MS = 20_000
const GEMINI_POLL_INTERVAL_MS = 200

function normalizeGeminiMessageKind(message: unknown): 'user' | 'gemini' | null {
  if (!message || typeof message !== 'object') {
    return null
  }

  const record = message as { type?: unknown; role?: unknown }
  const raw =
    typeof record.type === 'string'
      ? record.type
      : typeof record.role === 'string'
        ? record.role
        : null
  const normalized = raw ? raw.trim().toLowerCase() : ''

  if (normalized === 'user' || normalized === 'human') {
    return 'user'
  }

  if (
    normalized === 'gemini' ||
    normalized === 'assistant' ||
    normalized === 'model' ||
    normalized === 'bot'
  ) {
    return 'gemini'
  }

  return null
}

function resolveLastGeminiRelevantMessage(
  messages: unknown,
): { type: 'user' | 'gemini'; timestampMs: number | null } | null {
  if (!Array.isArray(messages)) {
    return null
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const kind = normalizeGeminiMessageKind(message)
    if (!kind) {
      continue
    }

    return {
      type: kind,
      timestampMs:
        message && typeof message === 'object' && 'timestamp' in message
          ? parseTimestampMs((message as { timestamp?: unknown }).timestamp)
          : message && typeof message === 'object' && 'createdAt' in message
            ? parseTimestampMs((message as { createdAt?: unknown }).createdAt)
            : null,
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
      filePath: '',
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

function createGeminiDiscoverySignature(meta: GeminiSessionMeta): string {
  return JSON.stringify({
    sessionId: meta.sessionId,
    updatedAtMs: meta.updatedAtMs,
    lastRelevantMessageAtMs: meta.lastRelevantMessageAtMs,
    lastRelevantMessageType: meta.lastRelevantMessageType,
  })
}

function toGeminiSessionCandidate(meta: GeminiSessionMeta): GeminiSessionCandidate {
  return {
    ...meta,
    discoverySignature: createGeminiDiscoverySignature(meta),
  }
}

async function listGeminiSessionCandidates(cwd: string): Promise<GeminiSessionCandidate[]> {
  const resolvedCwd = resolve(cwd)
  const projectDirectories = (
    await Promise.all(
      resolveHomeDirectoryCandidates().map(async homeDirectory => {
        const geminiTmpDir = join(homeDirectory, '.gemini', 'tmp')
        return await listDirectories(geminiTmpDir)
      }),
    )
  ).flat()
  const matchingProjectDirectories = (
    await Promise.all(
      projectDirectories.map(async projectDirectory => {
        const projectRoot = await fs
          .readFile(join(projectDirectory, '.project_root'), 'utf8')
          .then(normalizeAgentProjectRootPath)
          .catch(() => null)

        return projectRoot === resolvedCwd ? projectDirectory : null
      }),
    )
  ).filter((projectDirectory): projectDirectory is string => projectDirectory !== null)

  const candidates = (
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

            return toGeminiSessionCandidate({
              ...parsed,
              filePath: chatFile,
            })
          }),
        )
      }),
    )
  )
    .flat()
    .filter((candidate): candidate is GeminiSessionCandidate => candidate !== null)

  return candidates
}

export async function captureGeminiSessionDiscoveryCursor(
  cwd: string,
): Promise<GeminiSessionDiscoveryCursor> {
  const entriesByFilePath: Record<string, GeminiSessionDiscoveryCursorEntry> = {}

  for (const candidate of await listGeminiSessionCandidates(cwd)) {
    entriesByFilePath[candidate.filePath] = {
      signature: candidate.discoverySignature,
      hadRelevantTurn: candidate.lastRelevantMessageType !== null,
    }
  }

  return { entriesByFilePath }
}

function shouldAcceptGeminiCandidateFromCursor(
  candidate: GeminiSessionCandidate,
  discoveryCursor: GeminiSessionDiscoveryCursor | null | undefined,
): boolean {
  if (!discoveryCursor) {
    return true
  }

  const previous = discoveryCursor.entriesByFilePath[candidate.filePath]
  if (!previous) {
    return true
  }

  if (previous.hadRelevantTurn) {
    return false
  }

  return (
    candidate.lastRelevantMessageType !== null &&
    previous.signature !== candidate.discoverySignature
  )
}

export async function findGeminiResumeSessionId(
  cwd: string,
  startedAtMs: number,
  options: FindGeminiResumeSessionIdOptions = {},
): Promise<string | null> {
  const candidateSessionIds = (await listGeminiSessionCandidates(cwd))
    .filter(candidate => candidate.lastRelevantMessageType !== null)
    .filter(candidate => shouldAcceptGeminiCandidateFromCursor(candidate, options.discoveryCursor))
    .filter(candidate => {
      const timestampMs = resolveGeminiSessionTimestampMs(candidate, startedAtMs)
      return Math.abs(timestampMs - startedAtMs) <= GEMINI_CANDIDATE_WINDOW_MS
    })
    .map(candidate => candidate.sessionId)

  const matchingSessionIds = new Set(candidateSessionIds)
  if (matchingSessionIds.size > 1) {
    return null
  }

  const [sessionId] = candidateSessionIds
  return sessionId ?? null
}

async function pollGeminiResumeSessionId(
  cwd: string,
  startedAtMs: number,
  deadline: number,
  discoveryCursor: GeminiSessionDiscoveryCursor | null | undefined,
): Promise<string | null> {
  const detected = await findGeminiResumeSessionId(cwd, startedAtMs, {
    discoveryCursor,
  })
  if (detected) {
    return detected
  }

  if (Date.now() > deadline) {
    return null
  }

  await wait(GEMINI_POLL_INTERVAL_MS)
  return await pollGeminiResumeSessionId(cwd, startedAtMs, deadline, discoveryCursor)
}

export async function locateGeminiResumeSessionId({
  cwd,
  startedAtMs,
  timeoutMs,
  discoveryCursor,
}: {
  cwd: string
  startedAtMs: number
  timeoutMs: number
  discoveryCursor?: GeminiSessionDiscoveryCursor | null
}): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  return await pollGeminiResumeSessionId(cwd, startedAtMs, deadline, discoveryCursor)
}
