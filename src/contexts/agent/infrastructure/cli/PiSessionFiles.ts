import fs from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { resolveHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'
import { selectNearestAgentSessionId } from './AgentSessionCandidateSelector'
import { listDirectories, listFiles } from './AgentSessionLocatorProviders.utils'

const SESSION_CANDIDATE_WINDOW_MS = 20_000
const FIRST_LINE_LIMIT_BYTES = 64 * 1024

export interface PiSessionMetadata {
  cwd: string
  sessionId: string
  timestampMs: number
}

function resolvePiPath(value: string, cwd: string): string {
  const home = resolveHomeDirectoryCandidates()[0]
  const expanded =
    home && (value === '~' || value.startsWith('~/') || value.startsWith('~\\'))
      ? join(home, value.slice(2))
      : value
  return resolve(cwd, expanded)
}

async function readSessionDirectorySetting(filePath: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const settings: unknown = JSON.parse(raw.replace(/^\uFEFF/u, ''))
    return settings && typeof settings === 'object' && 'sessionDir' in settings
      ? settings.sessionDir
      : undefined
  } catch {
    return undefined
  }
}

async function resolvePiSessionRoots(cwd: string): Promise<string[]> {
  const configured = process.env.PI_CODING_AGENT_SESSION_DIR?.trim()
  if (configured) {
    return [resolvePiPath(configured, cwd)]
  }
  const agentDirectory = process.env.PI_CODING_AGENT_DIR?.trim()
  const agentDirectories = agentDirectory
    ? [resolvePiPath(agentDirectory, cwd)]
    : resolveHomeDirectoryCandidates().map(home => join(home, '.pi', 'agent'))
  const projectSetting = await readSessionDirectorySetting(join(cwd, '.pi', 'settings.json'))
  return await Promise.all(
    agentDirectories.map(async directory => {
      const setting =
        projectSetting !== undefined
          ? projectSetting
          : await readSessionDirectorySetting(join(directory, 'settings.json'))
      return typeof setting === 'string' && setting.trim().length > 0
        ? resolvePiPath(setting.trim(), cwd)
        : join(directory, 'sessions')
    }),
  )
}

/** Both the catalog and legacy UUID lookup use the same configured Pi storage roots. */
export async function listPiSessionFiles(cwd: string): Promise<string[]> {
  const roots = [...new Set(await resolvePiSessionRoots(cwd))]
  const directFiles = await Promise.all(roots.map(listFiles))
  const projectDirectories = (await Promise.all(roots.map(listDirectories))).flat()
  const nestedFiles = await Promise.all(projectDirectories.map(listFiles))
  return [...new Set([...directFiles, ...nestedFiles].flat())].filter(file =>
    file.endsWith('.jsonl'),
  )
}

export async function readPiSessionMetadata(filePath: string): Promise<PiSessionMetadata | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const buffer = Buffer.allocUnsafe(FIRST_LINE_LIMIT_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const contents = buffer.subarray(0, bytesRead).toString('utf8')
    const newlineIndex = contents.indexOf('\n')
    if (newlineIndex < 0 && bytesRead === buffer.length) {
      return null
    }
    const line = (newlineIndex >= 0 ? contents.slice(0, newlineIndex) : contents).trim()
    const parsed: unknown = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const record = parsed as Record<string, unknown>
    const sessionId = typeof record.id === 'string' ? record.id.trim() : ''
    const cwd = typeof record.cwd === 'string' && record.cwd.trim() ? resolve(record.cwd) : null
    const timestampMs = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN
    return record.type === 'session' &&
      record.version === 3 &&
      sessionId &&
      cwd &&
      Number.isFinite(timestampMs)
      ? { cwd, sessionId, timestampMs }
      : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function findPiResumeSessionId(
  cwd: string,
  startedAtMs: number,
): Promise<string | null> {
  const resolvedCwd = resolve(cwd)
  const candidates: Array<{ sessionId: string; timestampMs: number }> = []
  for (const filePath of await listPiSessionFiles(resolvedCwd)) {
    // eslint-disable-next-line no-await-in-loop
    const meta = await readPiSessionMetadata(filePath)
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
    return (await readPiSessionMetadata(sessionId)) ? sessionId : null
  }
  const resolvedCwd = resolve(cwd)
  for (const filePath of await listPiSessionFiles(resolvedCwd)) {
    // eslint-disable-next-line no-await-in-loop
    const meta = await readPiSessionMetadata(filePath)
    if (meta?.cwd === resolvedCwd && meta.sessionId === sessionId) {
      return filePath
    }
  }
  return null
}
