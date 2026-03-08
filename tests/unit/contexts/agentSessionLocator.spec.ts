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
})
