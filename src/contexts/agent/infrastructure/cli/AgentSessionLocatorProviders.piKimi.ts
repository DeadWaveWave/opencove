import fs from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { resolveHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'
import { selectNearestAgentSessionId } from './AgentSessionCandidateSelector'

const SESSION_CANDIDATE_WINDOW_MS = 20_000

export { findPiResumeSessionId, findPiSessionFilePath } from './PiSessionFiles'

interface KimiSessionIndexEntry {
  sessionDir: string
  sessionId: string
  workDir: string
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
