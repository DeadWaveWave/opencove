import fs from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { resolveHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'
import { selectNearestAgentSessionId } from './AgentSessionCandidateSelector'

const SESSION_CANDIDATE_WINDOW_MS = 20_000
const FIRST_LINE_LIMIT_BYTES = 64 * 1024

interface PiSessionMeta {
  cwd: string
  sessionId: string
  timestampMs: number
}

interface KimiSessionIndexEntry {
  sessionDir: string
  sessionId: string
  workDir: string
}

async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => join(directory, entry.name))
  } catch {
    return []
  }
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => join(directory, entry.name))
  } catch {
    return []
  }
}

async function readFirstLine(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const buffer = Buffer.allocUnsafe(FIRST_LINE_LIMIT_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const contents = buffer.subarray(0, bytesRead).toString('utf8')
    const newlineIndex = contents.indexOf('\n')
    const line = (newlineIndex >= 0 ? contents.slice(0, newlineIndex) : contents).trim()
    return line.length > 0 ? line : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function parsePiSessionMeta(line: string): PiSessionMeta | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    const sessionId = typeof parsed.id === 'string' ? parsed.id.trim() : ''
    const cwd = typeof parsed.cwd === 'string' ? resolve(parsed.cwd) : null
    const timestampMs = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN
    if (
      parsed.type !== 'session' ||
      parsed.version !== 3 ||
      sessionId.length === 0 ||
      !cwd ||
      !Number.isFinite(timestampMs)
    ) {
      return null
    }
    return { cwd, sessionId, timestampMs }
  } catch {
    return null
  }
}

function resolvePiSessionRoots(): string[] {
  const configured = process.env.PI_CODING_AGENT_SESSION_DIR?.trim()
  return configured
    ? [resolve(configured)]
    : resolveHomeDirectoryCandidates().map(home => join(home, '.pi', 'agent', 'sessions'))
}

async function listPiSessionFiles(): Promise<string[]> {
  const roots = resolvePiSessionRoots()
  const directFiles = await Promise.all(roots.map(listFiles))
  const projectDirectories = (await Promise.all(roots.map(listDirectories))).flat()
  const nestedFiles = await Promise.all(projectDirectories.map(listFiles))
  return [...directFiles, ...nestedFiles].flat()
}

export async function findPiResumeSessionId(
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  const resolvedCwd = resolve(cwd)
  const candidates: Array<{ sessionId: string; timestampMs: number }> = []
  for (const filePath of await listPiSessionFiles()) {
    // eslint-disable-next-line no-await-in-loop
    const line = await readFirstLine(filePath)
    const meta = line ? parsePiSessionMeta(line) : null
    if (meta?.cwd === resolvedCwd) {
      candidates.push({ sessionId: meta.sessionId, timestampMs: meta.timestampMs })
    }
  }
  return selectNearestAgentSessionId({
    candidates,
    startedAtMs,
    maxDistanceMs: SESSION_CANDIDATE_WINDOW_MS,
  })
}

export async function findPiSessionFilePath(
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  if (isAbsolute(sessionId)) {
    const line = await readFirstLine(sessionId)
    return line && parsePiSessionMeta(line) ? sessionId : null
  }
  const resolvedCwd = resolve(cwd)
  for (const filePath of await listPiSessionFiles()) {
    // eslint-disable-next-line no-await-in-loop
    const line = await readFirstLine(filePath)
    const meta = line ? parsePiSessionMeta(line) : null
    if (meta?.cwd === resolvedCwd && meta.sessionId === sessionId) {
      return filePath
    }
  }
  return null
}

function resolveKimiHome(): string {
  const configured = process.env.KIMI_CODE_HOME?.trim()
  const home = configured || resolveHomeDirectoryCandidates()[0] || process.cwd()
  return resolve(configured ? home : join(home, '.kimi-code'))
}

async function parseKimiSessionIndex(): Promise<KimiSessionIndexEntry[]> {
  const kimiHome = resolveKimiHome()
  const contents = await fs.readFile(join(kimiHome, 'session_index.jsonl'), 'utf8').catch(() => '')
  const sessionsRoot = join(kimiHome, 'sessions')
  const canonicalRoot = await fs.realpath(sessionsRoot).catch(() => null)
  if (!canonicalRoot) {
    return []
  }

  const entries: KimiSessionIndexEntry[] = []
  for (const line of contents.split(/\r?\n/u)) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : ''
      const sessionDir = typeof parsed.sessionDir === 'string' ? parsed.sessionDir.trim() : ''
      const workDir = typeof parsed.workDir === 'string' ? parsed.workDir.trim() : ''
      if (!sessionId || !isAbsolute(sessionDir) || !isAbsolute(workDir)) {
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const canonicalSessionDir = await fs.realpath(sessionDir).catch(() => null)
      if (!canonicalSessionDir) {
        continue
      }
      const pathFromRoot = relative(canonicalRoot, canonicalSessionDir)
      if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
        continue
      }
      if (canonicalSessionDir.split(/[\\/]/u).at(-1) !== sessionId) {
        continue
      }
      entries.push({ sessionId, sessionDir: canonicalSessionDir, workDir: resolve(workDir) })
    } catch {
      continue
    }
  }
  return entries
}

export async function findKimiWireFilePath(cwd: string, sessionId: string): Promise<string | null> {
  const resolvedCwd = resolve(cwd)
  const entry = (await parseKimiSessionIndex()).find(
    candidate => candidate.sessionId === sessionId && candidate.workDir === resolvedCwd,
  )
  if (!entry) {
    return null
  }
  const wirePath = join(entry.sessionDir, 'agents', 'main', 'wire.jsonl')
  const stats = await fs.stat(wirePath).catch(() => null)
  return stats?.isFile() ? wirePath : null
}

export async function findKimiResumeSessionId(
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  const resolvedCwd = resolve(cwd)
  const candidates: Array<{ sessionId: string; timestampMs: number }> = []
  for (const entry of await parseKimiSessionIndex()) {
    if (entry.workDir !== resolvedCwd) {
      continue
    }
    const wirePath = join(entry.sessionDir, 'agents', 'main', 'wire.jsonl')
    // eslint-disable-next-line no-await-in-loop
    const stats = await fs.stat(wirePath).catch(() => null)
    if (stats?.isFile()) {
      candidates.push({
        sessionId: entry.sessionId,
        timestampMs: stats.birthtimeMs || stats.mtimeMs,
      })
    }
  }
  return selectNearestAgentSessionId({
    candidates,
    startedAtMs,
    maxDistanceMs: SESSION_CANDIDATE_WINDOW_MS,
  })
}
