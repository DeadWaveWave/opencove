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
      title: null,
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

  it('lists Gemini sessions that match the current project root', async () => {
    const cwd = '/Users/tester/Development/cove'
    const tmpRoot = join('/Users/tester', '.gemini', 'tmp')
    const projectDirectory = join(tmpRoot, 'cove-worktree')
    const otherDirectory = join(tmpRoot, 'other')
    const chatFile = join(projectDirectory, 'chats', 'session-a.json')

    fsPromisesMock.readdir.mockImplementation(async (directory: string) => {
      if (directory === tmpRoot) {
        return [createDirectoryEntry('cove-worktree'), createDirectoryEntry('other')]
      }

      if (directory === join(projectDirectory, 'chats')) {
        return [createFileEntry('session-a.json')]
      }

      return []
    })

    fsPromisesMock.readFile.mockImplementation(async (filePath: string) => {
      if (filePath === join(projectDirectory, '.project_root')) {
        return cwd
      }

      if (filePath === join(otherDirectory, '.project_root')) {
        return '/Users/tester/Other'
      }

      if (filePath === chatFile) {
        return JSON.stringify({
          sessionId: 'gemini-session',
          startTime: '2026-04-28T08:00:00.000Z',
          lastUpdated: '2026-04-28T09:00:00.000Z',
        })
      }

      throw new Error(`Unexpected readFile ${filePath}`)
    })

    const result = await listAgentSessions({
      provider: 'gemini',
      cwd,
      limit: 10,
    })

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({
      sessionId: 'gemini-session',
      source: 'gemini-file',
    })
  })

  it('uses OpenCode CLI JSON output when available', async () => {
    const cwd = '/Users/tester/Development/cove'

    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(
        null,
        JSON.stringify([
          {
            id: 'ses_cli',
            directory: cwd,
            title: 'CLI session',
            created: '2026-04-28T08:00:00.000Z',
            updated: '2026-04-28T09:00:00.000Z',
          },
        ]),
        '',
      )
      return {} as ReturnType<typeof execFileMock>
    })

    const result = await listAgentSessions({
      provider: 'opencode',
      cwd,
      limit: 10,
    })

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({
      sessionId: 'ses_cli',
      title: 'CLI session',
      source: 'opencode-cli',
    })
  })

  it('falls back to OpenCode sqlite metadata when the CLI is unavailable', async () => {
    const cwd = '/Users/tester/Development/cove'

    execFileMock.mockImplementation((_file, _args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      cb?.(new Error('missing cli'), '', '')
      return {} as ReturnType<typeof execFileMock>
    })

    resolveOpenCodeDbPathMock.mockResolvedValue('/Users/tester/.local/share/opencode/opencode.db')
    openReadOnlySqliteDbMock.mockResolvedValue({
      prepare: (sql: string) => {
        if (sql.includes('sqlite_master')) {
          return {
            get: () => ({ name: 'session' }),
            all: () => [],
          }
        }

        if (sql.includes('PRAGMA table_info')) {
          return {
            get: () => undefined,
            all: () => [
              { name: 'id' },
              { name: 'directory' },
              { name: 'title' },
              { name: 'time_created' },
              { name: 'time_updated' },
            ],
          }
        }

        return {
          get: () => undefined,
          all: () => [
            {
              id: 'ses_db',
              directory: cwd,
              title: 'DB session',
              created: 1_777_370_800_000,
              updated: 1_777_374_400_000,
            },
          ],
        }
      },
      close: () => undefined,
    })

    const result = await listAgentSessions({
      provider: 'opencode',
      cwd,
      limit: 10,
    })

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({
      sessionId: 'ses_db',
      title: 'DB session',
      source: 'opencode-db',
    })
  })
})
