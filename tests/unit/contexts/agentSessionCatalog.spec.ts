import type { Dirent } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fsPromisesMock = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  open: vi.fn(),
}))
const osMock = vi.hoisted(() => ({
  homedir: vi.fn(() => '/Users/tester'),
}))
const execFileMock = vi.hoisted(() => vi.fn<typeof import('node:child_process').execFile>())
const resolveOpenCodeDbPathMock = vi.hoisted(() => vi.fn())
const openReadOnlySqliteDbMock = vi.hoisted(() => vi.fn())
const resolveAgentExecutableInvocationMock = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({ default: fsPromisesMock }))
vi.mock('node:os', () => ({ default: osMock }))
vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  default: {
    execFile: execFileMock,
  },
}))
vi.mock('../../../src/contexts/agent/infrastructure/cli/AgentExecutableResolver', () => ({
  resolveAgentExecutableInvocation: resolveAgentExecutableInvocationMock,
}))
vi.mock('../../../src/contexts/agent/infrastructure/opencode/OpenCodeDbLocator', () => ({
  resolveOpenCodeDbPath: resolveOpenCodeDbPathMock,
}))
vi.mock('../../../src/contexts/agent/infrastructure/opencode/OpenCodeSqlite', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/contexts/agent/infrastructure/opencode/OpenCodeSqlite')
  >('../../../src/contexts/agent/infrastructure/opencode/OpenCodeSqlite')
  return {
    ...actual,
    openReadOnlySqliteDb: openReadOnlySqliteDbMock,
  }
})
import { listAgentSessions } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog'
import { clearSessionFileCache } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionCatalog.cache'
import type { AgentSessionTitleCacheStore } from '../../../src/contexts/agent/infrastructure/cli/AgentSessionTitleCacheStore'

function createFileEntry(name: string): Dirent {
  return { name, isFile: () => true, isDirectory: () => false } as unknown as Dirent
}
function createDirectoryEntry(name: string): Dirent {
  return { name, isFile: () => false, isDirectory: () => true } as unknown as Dirent
}
function toClaudeProjectDir(cwd: string): string {
  const encodedPath = resolve(cwd).replace(/[\\/]/g, '-').replace(/:/g, '')
  return join('/Users/tester', '.claude', 'projects', encodedPath)
}

function createOpenHandle(contents: string): {
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ) => Promise<{
    bytesRead: number
    buffer: Buffer
  }>
  close: () => Promise<void>
} {
  const source = Buffer.from(contents, 'utf8')
  let cursor = 0

  return {
    read: async (buffer, offset, length) => {
      const remaining = Math.max(0, source.length - cursor)
      const bytesRead = Math.min(length, remaining)
      if (bytesRead > 0) {
        source.copy(buffer, offset, cursor, cursor + bytesRead)
        cursor += bytesRead
      }

      return { bytesRead, buffer }
    },
    close: async () => undefined,
  }
}

describe('listAgentSessions', () => {
  const originalHome = process.env.HOME

  beforeEach(() => {
    vi.clearAllMocks()
    clearSessionFileCache()
    process.env.HOME = '/Users/tester'
    osMock.homedir.mockReturnValue('/Users/tester')
    fsPromisesMock.readdir.mockResolvedValue([])
    fsPromisesMock.stat.mockRejectedValue(new Error('ENOENT'))
    fsPromisesMock.readFile.mockRejectedValue(new Error('ENOENT'))
    fsPromisesMock.open.mockRejectedValue(new Error('ENOENT'))
    resolveOpenCodeDbPathMock.mockResolvedValue(null)
    openReadOnlySqliteDbMock.mockReset()
    resolveAgentExecutableInvocationMock.mockResolvedValue({
      executable: {
        provider: 'opencode',
        toolId: 'opencode',
        command: 'opencode',
        executablePath: 'opencode',
        source: 'process_path',
        status: 'resolved',
        diagnostics: [],
      },
      invocation: {
        command: 'opencode',
        args: ['session', 'list', '--format', 'json', '-n', '20'],
      },
      commandEnvironment: {
        env: { PATH: '/shell/bin' },
        shellPath: '/bin/zsh',
        source: 'shell_env',
        diagnostics: [],
      },
    })
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  it('prefers Claude sessions-index summaries when present', async () => {
    const cwd = '/Users/tester/Development/cove'
    const projectDir = toClaudeProjectDir(cwd)

    fsPromisesMock.readFile.mockImplementation(async (filePath: string) => {
      if (filePath === join(projectDir, 'sessions-index.json')) {
        return JSON.stringify({
          entries: [
            {
              sessionId: 'claude-session-2',
              projectPath: cwd,
              firstPrompt: 'Fix flaky tests',
              created: '2026-04-28T09:00:00.000Z',
              modified: '2026-04-28T09:30:00.000Z',
            },
            {
              sessionId: 'claude-session-1',
              projectPath: cwd,
              firstPrompt: 'Investigate restart recovery',
              created: '2026-04-27T08:00:00.000Z',
              modified: '2026-04-27T08:15:00.000Z',
            },
          ],
        })
      }

      throw new Error(`Unexpected readFile ${filePath}`)
    })

    const result = await listAgentSessions({
      provider: 'claude-code',
      cwd,
      limit: 10,
    })

    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0]).toMatchObject({
      sessionId: 'claude-session-2',
      title: 'Fix flaky tests',
      preview: 'Fix flaky tests',
      source: 'claude-index',
    })
  })

  it('falls back to Claude jsonl files when the index is missing', async () => {
    const cwd = '/Users/tester/Development/cove'
    const projectDir = toClaudeProjectDir(cwd)
    const latestFile = join(projectDir, 'session-b.jsonl')
    const olderFile = join(projectDir, 'session-a.jsonl')

    fsPromisesMock.readdir.mockImplementation(async (directory: string) => {
      if (directory === projectDir) {
        return [createFileEntry('session-a.jsonl'), createFileEntry('session-b.jsonl')]
      }

      return []
    })

    fsPromisesMock.stat.mockImplementation(async (filePath: string) => {
      if (filePath === latestFile) {
        return { mtimeMs: Date.parse('2026-04-28T10:00:00.000Z') }
      }

      if (filePath === olderFile) {
        return { mtimeMs: Date.parse('2026-04-28T09:00:00.000Z') }
      }

      throw new Error(`Unexpected stat ${filePath}`)
    })

    fsPromisesMock.open.mockImplementation(async (filePath: string) => {
      if (filePath === latestFile) {
        return createOpenHandle(
          `${JSON.stringify({
            type: 'user',
            timestamp: '2026-04-28T09:55:00.000Z',
            content: 'Improve\n session    discoverability',
          })}\n`,
        )
      }

      if (filePath === olderFile) {
        return createOpenHandle(
          `${JSON.stringify({
            type: 'user',
            timestamp: '2026-04-28T08:55:00.000Z',
            content: 'Fix archived task mapping',
          })}\n`,
        )
      }

      throw new Error(`Unexpected open ${filePath}`)
    })

    const result = await listAgentSessions({
      provider: 'claude-code',
      cwd,
      limit: 10,
    })

    expect(result.sessions.map(session => session.sessionId)).toEqual(['session-b', 'session-a'])
    expect(result.sessions[0]?.source).toBe('claude-jsonl')
    expect(result.sessions[0]?.preview).toBe('Improve session discoverability')
  })

  it('prefers the Claude ai-title over the first user message for the title', async () => {
    const cwd = '/Users/tester/Development/cove'
    const projectDir = toClaudeProjectDir(cwd)
    const filePath = join(projectDir, 'session-x.jsonl')

    fsPromisesMock.readdir.mockImplementation(async (directory: string) => {
      return directory === projectDir ? [createFileEntry('session-x.jsonl')] : []
    })

    fsPromisesMock.stat.mockImplementation(async (target: string) => {
      if (target === filePath) {
        return { mtimeMs: Date.parse('2026-04-28T10:00:00.000Z'), size: 2048 }
      }

      throw new Error(`Unexpected stat ${target}`)
    })

    fsPromisesMock.open.mockImplementation(async (target: string) => {
      if (target === filePath) {
        return createOpenHandle(
          `${JSON.stringify({ type: 'user', content: 'Investigate restart recovery' })}\n${JSON.stringify(
            { type: 'ai-title', aiTitle: 'Restart recovery investigation' },
          )}\n`,
        )
      }

      throw new Error(`Unexpected open ${target}`)
    })

    const result = await listAgentSessions({ provider: 'claude-code', cwd, limit: 10 })

    expect(result.sessions[0]).toMatchObject({
      sessionId: 'session-x',
      title: 'Restart recovery investigation',
      preview: 'Investigate restart recovery',
      source: 'claude-jsonl',
    })
  })

  it('reuses cached Claude titles until the file fingerprint changes', async () => {
    const cwd = '/Users/tester/Development/cove'
    const projectDir = toClaudeProjectDir(cwd)
    const filePath = join(projectDir, 'session-c.jsonl')

    fsPromisesMock.readdir.mockImplementation(async (directory: string) => {
      return directory === projectDir ? [createFileEntry('session-c.jsonl')] : []
    })

    let fingerprint = { mtimeMs: Date.parse('2026-04-28T10:00:00.000Z'), size: 1024 }
    fsPromisesMock.stat.mockImplementation(async (target: string) => {
      if (target === filePath) {
        return fingerprint
      }

      throw new Error(`Unexpected stat ${target}`)
    })

    fsPromisesMock.open.mockImplementation(async (target: string) => {
      if (target === filePath) {
        return createOpenHandle(
          `${JSON.stringify({ type: 'ai-title', aiTitle: 'Cached title' })}\n`,
        )
      }

      throw new Error(`Unexpected open ${target}`)
    })

    await listAgentSessions({ provider: 'claude-code', cwd, limit: 10 })
    const openCallsAfterFirst = fsPromisesMock.open.mock.calls.length
    expect(openCallsAfterFirst).toBeGreaterThan(0)

    // 指纹不变 → 命中缓存,不再打开文件
    await listAgentSessions({ provider: 'claude-code', cwd, limit: 10 })
    expect(fsPromisesMock.open.mock.calls.length).toBe(openCallsAfterFirst)

    // 文件被追加(mtime/size 变化)→ 缓存失效,重新扫描
    fingerprint = { mtimeMs: Date.parse('2026-04-28T11:00:00.000Z'), size: 4096 }
    await listAgentSessions({ provider: 'claude-code', cwd, limit: 10 })
    expect(fsPromisesMock.open.mock.calls.length).toBeGreaterThan(openCallsAfterFirst)
  })

  it('serves Claude titles from the injected persistent cache (L2) without rescanning', async () => {
    const cwd = '/Users/tester/Development/cove'
    const projectDir = toClaudeProjectDir(cwd)
    const filePath = join(projectDir, 'session-p.jsonl')

    fsPromisesMock.readdir.mockImplementation(async (directory: string) => {
      return directory === projectDir ? [createFileEntry('session-p.jsonl')] : []
    })

    fsPromisesMock.stat.mockImplementation(async (target: string) => {
      if (target === filePath) {
        return { mtimeMs: Date.parse('2026-04-28T10:00:00.000Z'), size: 2048 }
      }

      throw new Error(`Unexpected stat ${target}`)
    })

    fsPromisesMock.open.mockImplementation(async (target: string) => {
      if (target === filePath) {
        return createOpenHandle(
          `${JSON.stringify({ type: 'user', content: 'Investigate restart recovery' })}\n${JSON.stringify(
            { type: 'ai-title', aiTitle: 'Restart recovery investigation' },
          )}\n`,
        )
      }

      throw new Error(`Unexpected open ${target}`)
    })

    const rows = new Map<string, { mtimeMs: number; size: number; value: unknown }>()
    const titleCache: AgentSessionTitleCacheStore = {
      read: (cachedFilePath, fingerprint) => {
        const row = rows.get(cachedFilePath)
        if (!row || row.mtimeMs !== fingerprint.mtimeMs || row.size !== fingerprint.size) {
          return null
        }

        return { value: row.value }
      },
      write: ({ filePath: cachedFilePath, fingerprint, value }) => {
        rows.set(cachedFilePath, { mtimeMs: fingerprint.mtimeMs, size: fingerprint.size, value })
      },
      pruneMissing: () => 0,
      dispose: () => undefined,
    }

    await listAgentSessions({ provider: 'claude-code', cwd, limit: 10 }, { titleCache })
    const openCallsAfterFirst = fsPromisesMock.open.mock.calls.length
    expect(openCallsAfterFirst).toBeGreaterThan(0)
    expect(rows.size).toBe(1)

    // 丢弃 L1,迫使第二次只能依赖注入的 L2:命中则不应再打开文件。
    clearSessionFileCache()
    const result = await listAgentSessions(
      { provider: 'claude-code', cwd, limit: 10 },
      { titleCache },
    )

    expect(fsPromisesMock.open.mock.calls.length).toBe(openCallsAfterFirst)
    expect(result.sessions[0]).toMatchObject({
      sessionId: 'session-p',
      title: 'Restart recovery investigation',
      preview: 'Investigate restart recovery',
    })
  })

  it('lists Codex sessions by scanning rollout metadata across date directories', async () => {
    const cwd = '/Users/tester/Development/cove'
    const sessionsRoot = join('/Users/tester', '.codex', 'sessions')
    const dayDirectory = join(sessionsRoot, '2026', '04', '28')
    const newerFile = join(dayDirectory, 'rollout-newer.jsonl')
    const olderFile = join(dayDirectory, 'rollout-older.jsonl')
    const otherFile = join(dayDirectory, 'rollout-other.jsonl')

    fsPromisesMock.readdir.mockImplementation(async (directory: string) => {
      if (directory === sessionsRoot) {
        return [createDirectoryEntry('2026')]
      }

      if (directory === join(sessionsRoot, '2026')) {
        return [createDirectoryEntry('04')]
      }

      if (directory === join(sessionsRoot, '2026', '04')) {
        return [createDirectoryEntry('28')]
      }

      if (directory === dayDirectory) {
        return [
          createFileEntry('rollout-newer.jsonl'),
          createFileEntry('rollout-older.jsonl'),
          createFileEntry('rollout-other.jsonl'),
        ]
      }

      return []
    })

    fsPromisesMock.open.mockImplementation(async (filePath: string) => {
      if (filePath === newerFile) {
        return createOpenHandle(
          `${JSON.stringify({
            type: 'session_meta',
            timestamp: '2026-04-28T12:00:00.000Z',
            payload: {
              id: 'codex-newer',
              cwd,
              timestamp: '2026-04-28T11:59:00.000Z',
            },
          })}\n${JSON.stringify({
            type: 'response_item',
            payload: {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Inspect the new session list UX',
                },
              ],
            },
          })}\n`,
        )
      }

      if (filePath === olderFile) {
        return createOpenHandle(
          `${JSON.stringify({
            type: 'session_meta',
            timestamp: '2026-04-28T10:00:00.000Z',
            payload: {
              id: 'codex-older',
              cwd,
              timestamp: '2026-04-28T09:58:00.000Z',
            },
          })}\n${JSON.stringify({
            type: 'message',
            id: null,
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Audit old session recovery behavior',
              },
            ],
          })}\n`,
        )
      }

      if (filePath === otherFile) {
        return createOpenHandle(
          `${JSON.stringify({
            type: 'session_meta',
            timestamp: '2026-04-28T13:00:00.000Z',
            payload: {
              id: 'codex-other',
              cwd: '/Users/tester/Other',
              timestamp: '2026-04-28T12:58:00.000Z',
            },
          })}\n`,
        )
      }

      throw new Error(`Unexpected open ${filePath}`)
    })

    const result = await listAgentSessions({
      provider: 'codex',
      cwd,
      limit: 10,
    })

    expect(result.sessions.map(session => session.sessionId)).toEqual([
      'codex-newer',
      'codex-older',
    ])
    expect(result.sessions[0]?.source).toBe('codex-file')
    expect(result.sessions[0]?.preview).toBe('Inspect the new session list UX')
  })
})
