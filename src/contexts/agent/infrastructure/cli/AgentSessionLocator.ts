import fs from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { AgentProviderId } from '@shared/contracts/dto'
import { listCodexSessionFiles, resolveCodexSessionTimestampMs } from './CodexSessionFiles'
import { resolveClaudeProjectDirectoryCandidateGroups } from '../ClaudeProjectPaths'
import {
  findGeminiResumeSessionId,
  findOpenCodeResumeSessionId,
} from './AgentSessionLocatorProviders'
import { selectNearestAgentSessionId } from './AgentSessionCandidateSelector'
import {
  findKimiResumeSessionId,
  findPiResumeSessionId,
} from './AgentSessionLocatorProviders.piKimi'

interface LocateAgentResumeSessionInput {
  provider: AgentProviderId
  cwd: string
  startedAtMs: number
  timeoutMs?: number
}

const POLL_INTERVAL_MS = 200
const DEFAULT_TIMEOUT_MS = 2600
const CODEX_CANDIDATE_WINDOW_MS = 20_000

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

async function findLatestClaudeResumeSessionIdInProjectDirectoryGroup(
  projectDirectoryGroup: string[],
  startedAtMs: number,
): Promise<string | null> {
  const files = (
    await Promise.all(
      projectDirectoryGroup.map(async projectDir => {
        return (await listFiles(projectDir)).filter(file => file.endsWith('.jsonl'))
      }),
    )
  ).flat()

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

  return latest ? normalizeSessionIdFromPath(latest.file) : null
}

async function findClaudeResumeSessionIdInProjectDirectoryGroups(
  projectDirectoryGroups: string[][],
  startedAtMs: number,
  index = 0,
): Promise<string | null> {
  const projectDirectoryGroup = projectDirectoryGroups[index]
  if (!projectDirectoryGroup) {
    return null
  }

  const found = await findLatestClaudeResumeSessionIdInProjectDirectoryGroup(
    projectDirectoryGroup,
    startedAtMs,
  )
  if (found) {
    return found
  }

  return await findClaudeResumeSessionIdInProjectDirectoryGroups(
    projectDirectoryGroups,
    startedAtMs,
    index + 1,
  )
}

async function findClaudeResumeSessionId(cwd: string, startedAtMs: number): Promise<string | null> {
  return await findClaudeResumeSessionIdInProjectDirectoryGroups(
    resolveClaudeProjectDirectoryCandidateGroups(cwd),
    startedAtMs,
  )
}

async function findCodexResumeSessionId(cwd: string, startedAtMs: number): Promise<string | null> {
  const files = await listCodexSessionFiles({ cwd, startedAtMs })
  return selectNearestAgentSessionId({
    candidates: files.map(meta => ({
      sessionId: meta.sessionId,
      timestampMs: resolveCodexSessionTimestampMs(meta, startedAtMs),
    })),
    startedAtMs,
    maxDistanceMs: CODEX_CANDIDATE_WINDOW_MS,
  })
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

  if (provider === 'pi') {
    return await findPiResumeSessionId(cwd, startedAtMs)
  }

  if (provider === 'kimi') {
    return await findKimiResumeSessionId(cwd, startedAtMs)
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
  if (timeoutMs <= 0) {
    return await tryFindResumeSessionId(provider, cwd, startedAtMs)
  }

  const deadline = Date.now() + timeoutMs
  return await pollResumeSessionId(provider, cwd, startedAtMs, deadline)
}
