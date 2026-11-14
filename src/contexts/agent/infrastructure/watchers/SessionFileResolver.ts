import fs from 'node:fs/promises'
import { waitForSessionReadRetry } from '../AgentSessionReadLifetime'
import { basename, join, resolve } from 'node:path'
import type { AgentProviderId } from '@shared/contracts/dto'
import { resolveHomeDirectoryCandidates } from '../../../../platform/os/HomeDirectory'
import { listCodexSessionFiles } from '../cli/CodexSessionFiles'
import { normalizeAgentProjectRootPath } from '../AgentProjectRootPath'
import { resolveClaudeProjectDirectoryCandidateGroups } from '../ClaudeProjectPaths'
import {
  findKimiWireFilePath,
  findPiSessionFilePath,
} from '../cli/AgentSessionLocatorProviders.piKimi'

interface ResolveSessionFilePathInput {
  provider: AgentProviderId
  cwd: string
  sessionId: string
  startedAtMs: number
  timeoutMs?: number
  signal?: AbortSignal
}

const POLL_INTERVAL_MS = 200
const DEFAULT_TIMEOUT_MS = 2600

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

function resolveClaudeSessionFilePathGroups(cwd: string, sessionId: string): string[][] {
  return resolveClaudeProjectDirectoryCandidateGroups(cwd).map(projectDirectoryGroup =>
    projectDirectoryGroup.map(projectDirectory => join(projectDirectory, `${sessionId}.jsonl`)),
  )
}

async function findExistingClaudeSessionFilePathInGroups(
  resolvedPathGroups: string[][],
  index = 0,
): Promise<string | null> {
  const resolvedPathGroup = resolvedPathGroups[index]
  if (!resolvedPathGroup) {
    return null
  }

  const existingPaths = await Promise.all(resolvedPathGroup.map(ensureFileExists))
  const existingPath = existingPaths.find((path): path is string => typeof path === 'string')
  if (existingPath) {
    return existingPath
  }

  return await findExistingClaudeSessionFilePathInGroups(resolvedPathGroups, index + 1)
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
  signal?: AbortSignal,
): Promise<string | null> {
  const files = await listCodexSessionFiles({ cwd, sessionId, startedAtMs, signal })
  const normalize = (directory: string): string => {
    const resolved = resolve(directory)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return files.find(file => normalize(file.cwd) === normalize(cwd))?.filePath ?? null
}

async function findGeminiSessionFilePath(cwd: string, sessionId: string): Promise<string | null> {
  const resolvedCwd = resolve(cwd)
  const projectDirectories = (
    await Promise.all(
      resolveHomeDirectoryCandidates().map(async homeDirectory => {
        const geminiTmpDir = join(homeDirectory, '.gemini', 'tmp')
        return await listDirectories(geminiTmpDir)
      }),
    )
  ).flat()

  for (const projectDirectory of projectDirectories) {
    const projectRoot = await fs
      .readFile(join(projectDirectory, '.project_root'), 'utf8')
      .then(normalizeAgentProjectRootPath)
      .catch(() => null)

    if (projectRoot !== resolvedCwd) {
      continue
    }

    const chatFiles = (await listFiles(join(projectDirectory, 'chats'))).filter(file => {
      return file.endsWith('.json') && basename(file).startsWith('session-')
    })

    for (const chatFile of chatFiles) {
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
  signal?: AbortSignal,
): Promise<string | null> {
  if (provider === 'claude-code') {
    return await findExistingClaudeSessionFilePathInGroups(
      resolveClaudeSessionFilePathGroups(cwd, sessionId),
    )
  }

  if (provider === 'codex') {
    return await findCodexSessionFilePath(cwd, sessionId, startedAtMs, signal)
  }

  if (provider === 'gemini') {
    return await findGeminiSessionFilePath(cwd, sessionId)
  }

  if (provider === 'pi') {
    return await findPiSessionFilePath(cwd, sessionId)
  }

  if (provider === 'kimi') {
    return await findKimiWireFilePath(cwd, sessionId)
  }

  return null
}

async function pollSessionFilePath(
  provider: AgentProviderId,
  cwd: string,
  sessionId: string,
  startedAtMs: number,
  deadline: number,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted()
  const resolvedPath = await tryResolveSessionFilePath(
    provider,
    cwd,
    sessionId,
    startedAtMs,
    signal,
  )
  signal?.throwIfAborted()
  if (resolvedPath) {
    return resolvedPath
  }

  if (Date.now() > deadline) {
    return null
  }

  await waitForSessionReadRetry(POLL_INTERVAL_MS, signal)
  return await pollSessionFilePath(provider, cwd, sessionId, startedAtMs, deadline, signal)
}

export async function resolveSessionFilePath({
  provider,
  cwd,
  sessionId,
  startedAtMs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: ResolveSessionFilePathInput): Promise<string | null> {
  signal?.throwIfAborted()
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId.length === 0) {
    return null
  }

  const deadline = Date.now() + timeoutMs
  return await pollSessionFilePath(
    provider,
    cwd,
    normalizedSessionId,
    startedAtMs,
    deadline,
    signal,
  )
}
