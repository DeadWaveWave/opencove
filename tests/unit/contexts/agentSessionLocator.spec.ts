import type { Dirent } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsPromisesMock = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
}))

const osMock = vi.hoisted(() => ({
  homedir: vi.fn(() => '/Users/tester'),
}))

vi.mock('node:fs/promises', () => ({
  default: fsPromisesMock,
}))

vi.mock('node:os', () => ({
  default: osMock,
}))

import { locateAgentResumeSessionId } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionLocator'

function createFileEntry(name: string): Dirent {
  return {
    name,
    isFile: () => true,
  } as unknown as Dirent
}

function createDirectoryEntry(name: string): Dirent {
  return {
    name,
    isDirectory: () => true,
  } as unknown as Dirent
}

function toClaudeProjectDir(cwd: string): string {
  const encodedPath = resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, '')
  return join('/Users/tester', '.claude', 'projects', encodedPath)
}

describe('locateAgentResumeSessionId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    osMock.homedir.mockReturnValue('/Users/tester')
  })

  it('uses latest claude jsonl filename as resume session id', async () => {
    const cwd = '/Users/tester/Development/cove'
    const startedAtMs = 1_707_000_000_000
    const projectDir = toClaudeProjectDir(cwd)
    const latestFile = join(projectDir, 'agent-a5170af.jsonl')

    fsPromisesMock.readdir.mockResolvedValue([
      createFileEntry('agent-a5170af.jsonl'),
      createFileEntry('agent-legacy.jsonl'),
    ])

    fsPromisesMock.stat.mockImplementation(async (filePath: string) => {
      if (filePath === latestFile) {
        return { mtimeMs: startedAtMs + 150 }
      }

      return { mtimeMs: startedAtMs + 50 }
    })

    const sessionId = await locateAgentResumeSessionId({
      provider: 'claude-code',
      cwd,
      startedAtMs,
      timeoutMs: 10,
    })

    expect(sessionId).toBe('agent-a5170af')
  })

  it('supports uuid-style claude jsonl filenames', async () => {
    const cwd = '/Users/tester/Development/cove'
    const startedAtMs = 1_707_000_000_000
    const projectDir = toClaudeProjectDir(cwd)
    const sessionId = 'c954dfa5-20a2-45eb-bfe6-1802f9b41683'
    const fileName = `${sessionId}.jsonl`
    const targetFile = join(projectDir, fileName)

    fsPromisesMock.readdir.mockResolvedValue([createFileEntry(fileName)])

    fsPromisesMock.stat.mockImplementation(async (filePath: string) => {
      if (filePath === targetFile) {
        return { mtimeMs: startedAtMs + 100 }
      }

      return { mtimeMs: startedAtMs - 20_000 }
    })

    const detected = await locateAgentResumeSessionId({
      provider: 'claude-code',
      cwd,
      startedAtMs,
      timeoutMs: 10,
    })

    expect(detected).toBe(sessionId)
  })

  it('locates a gemini session by matching the project root and chat metadata', async () => {
    const cwd = '/Users/tester/Development/cove'
    const startedAtMs = Date.parse('2026-03-15T07:58:10.970Z')
    const projectDirectory = '/Users/tester/.gemini/tmp/cove-worktree'
    const chatPath = `${projectDirectory}/chats/session-2026-03-15T07-58-d7d89910.json`

    fsPromisesMock.readdir.mockImplementation(async (directory: string) => {
      if (directory === '/Users/tester/.gemini/tmp') {
        return [createDirectoryEntry('cove-worktree')]
      }

      if (directory === `${projectDirectory}/chats`) {
        return [createFileEntry('session-2026-03-15T07-58-d7d89910.json')]
      }

      return []
    })

    fsPromisesMock.readFile.mockImplementation(async (filePath: string) => {
      if (filePath === `${projectDirectory}/.project_root`) {
        return cwd
      }

      if (filePath === chatPath) {
        return JSON.stringify({
          sessionId: 'd7d89910-fa86-4253-a183-07db548da987',
          startTime: '2026-03-15T07:58:10.970Z',
          lastUpdated: '2026-03-15T07:59:35.130Z',
          messages: [
            {
              type: 'user',
              timestamp: '2026-03-15T07:58:10.977Z',
            },
            {
              type: 'gemini',
              timestamp: '2026-03-15T07:59:35.130Z',
            },
          ],
        })
      }

      throw new Error(`Unexpected readFile: ${filePath}`)
    })

    const detected = await locateAgentResumeSessionId({
      provider: 'gemini',
      cwd,
      startedAtMs,
      timeoutMs: 0,
    })

    expect(detected).toBe('d7d89910-fa86-4253-a183-07db548da987')
  })

  it('ignores gemini info-only sessions and resolves the real turn session', async () => {
    const cwd = '/Users/tester/Development/cove'
    const startedAtMs = Date.parse('2026-03-15T09:40:57.900Z')
    const projectDirectory = '/Users/tester/.gemini/tmp/cove-worktree'
    const infoOnlyChatPath = `${projectDirectory}/chats/session-2026-03-15T09-40-info.json`
    const turnChatPath = `${projectDirectory}/chats/session-2026-03-15T09-40-turn.json`

    fsPromisesMock.readdir.mockImplementation(async (directory: string) => {
      if (directory === '/Users/tester/.gemini/tmp') {
        return [createDirectoryEntry('cove-worktree')]
      }

      if (directory === `${projectDirectory}/chats`) {
        return [
          createFileEntry('session-2026-03-15T09-40-info.json'),
          createFileEntry('session-2026-03-15T09-40-turn.json'),
        ]
      }

      return []
    })

    fsPromisesMock.readFile.mockImplementation(async (filePath: string) => {
      if (filePath === `${projectDirectory}/.project_root`) {
        return cwd
      }

      if (filePath === infoOnlyChatPath) {
        return JSON.stringify({
          sessionId: 'info-only-session',
          startTime: '2026-03-15T09:40:56.000Z',
          lastUpdated: '2026-03-15T09:40:56.000Z',
          messages: [
            {
              type: 'info',
              timestamp: '2026-03-15T09:40:56.000Z',
            },
          ],
        })
      }

      if (filePath === turnChatPath) {
        return JSON.stringify({
          sessionId: 'real-turn-session',
          startTime: '2026-03-15T09:40:57.800Z',
          lastUpdated: '2026-03-15T09:40:59.400Z',
          messages: [
            {
              type: 'user',
              timestamp: '2026-03-15T09:40:57.957Z',
            },
            {
              type: 'gemini',
              timestamp: '2026-03-15T09:40:59.410Z',
            },
          ],
        })
      }

      throw new Error(`Unexpected readFile: ${filePath}`)
    })

    const detected = await locateAgentResumeSessionId({
      provider: 'gemini',
      cwd,
      startedAtMs,
      timeoutMs: 0,
    })

    expect(detected).toBe('real-turn-session')
  })
})
