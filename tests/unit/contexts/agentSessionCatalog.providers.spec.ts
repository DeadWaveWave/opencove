import type { Dirent } from 'node:fs'
import { join } from 'node:path'
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

function createFileEntry(name: string): Dirent {
  return { name, isFile: () => true, isDirectory: () => false } as unknown as Dirent
}

function createDirectoryEntry(name: string): Dirent {
  return { name, isFile: () => false, isDirectory: () => true } as unknown as Dirent
}

describe('listAgentSessions provider-specific catalogs', () => {
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
