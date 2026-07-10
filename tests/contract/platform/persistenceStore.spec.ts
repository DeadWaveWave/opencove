import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  createMockDatabaseModule,
  createMockDbState,
  type MockDbState,
} from './persistenceStoreTestSupport'

describe('PersistenceStore', () => {
  let tempDir = ''

  afterEach(async () => {
    vi.useRealTimers()
    vi.resetModules()
    vi.clearAllMocks()

    if (!tempDir) {
      return
    }

    await rm(tempDir, { recursive: true, force: true })
    tempDir = ''
  })

  it(
    'writes workspace sort_order from the in-memory array order',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>()
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })

      const result = await store.writeAppState({
        formatVersion: 1,
        activeWorkspaceId: 'ws-2',
        workspaces: [
          {
            id: 'ws-2',
            name: 'Workspace 2',
            path: '/tmp/ws-2',
            worktreesRoot: '/tmp',
            pullRequestBaseBranchOptions: [],
            spaceArchiveRecords: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: false,
            activeSpaceId: null,
            nodes: [],
            spaces: [],
          },
          {
            id: 'ws-1',
            name: 'Workspace 1',
            path: '/tmp/ws-1',
            worktreesRoot: '/tmp',
            pullRequestBaseBranchOptions: [],
            spaceArchiveRecords: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: false,
            activeSpaceId: null,
            nodes: [],
            spaces: [],
          },
        ],
        settings: {},
      })

      expect(result).toMatchObject({ ok: true, level: 'full' })
      expect(mockDbByPath.get(dbPath)?.workspaceRows).toEqual([
        { id: 'ws-2', sortOrder: 0 },
        { id: 'ws-1', sortOrder: 1 },
      ])

      store.dispose()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'persists project icons and agent sidebar sort order through sqlite columns',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>()
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })

      const result = await store.writeAppState({
        formatVersion: 1,
        activeWorkspaceId: 'ws-1',
        workspaces: [
          {
            id: 'ws-1',
            name: 'Workspace 1',
            iconId: 'code',
            path: '/tmp/ws-1',
            worktreesRoot: '/tmp',
            pullRequestBaseBranchOptions: [],
            environmentVariables: {},
            spaceArchiveRecords: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: false,
            activeSpaceId: null,
            nodes: [
              {
                id: 'agent-1',
                sessionId: 'session-1',
                title: 'Agent 1',
                titlePinnedByUser: false,
                position: { x: 0, y: 0 },
                width: 640,
                height: 420,
                kind: 'agent',
                profileId: null,
                runtimeKind: null,
                terminalGeometry: null,
                terminalProviderHint: null,
                labelColorOverride: null,
                sidebarSortOrder: 3,
                status: 'running',
                startedAt: '2026-01-01T00:00:00.000Z',
                endedAt: null,
                exitCode: null,
                lastError: null,
                executionDirectory: '/tmp/ws-1',
                expectedDirectory: '/tmp/ws-1',
                agent: { provider: 'codex' },
                task: null,
                scrollback: null,
              },
            ],
            spaces: [],
          },
        ],
        settings: {},
      })

      expect(result).toMatchObject({ ok: true, level: 'full' })
      expect(mockDbByPath.get(dbPath)?.workspaceIconRows).toEqual([{ id: 'ws-1', iconId: 'code' }])
      expect(mockDbByPath.get(dbPath)?.nodeRows).toEqual([{ id: 'agent-1', sidebarSortOrder: 3 }])

      store.dispose()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'creates a backup when migrating an existing db file',
    async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'))

      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      await writeFile(dbPath, 'legacy-db')

      const mockDbByPath = new Map<string, MockDbState>()
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      store.dispose()

      const files = await readdir(tempDir)
      const backupFiles = files.filter(name => name.startsWith('opencove.db.bak-'))
      expect(backupFiles).toHaveLength(1)

      const backupContent = await readFile(join(tempDir, backupFiles[0] as string), 'utf8')
      expect(backupContent).toBe('legacy-db')
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'renames the db file when sqlite open fails (corruption recovery)',
    async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'))

      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      await writeFile(dbPath, 'corrupt-db')

      const mockDbByPath = new Map<string, MockDbState>([
        [dbPath, createMockDbState({ failOnFirstOpen: true })],
      ])
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      store.dispose()

      const files = await readdir(tempDir)
      expect(files).toContain('opencove.db.corrupt-2026-02-28T00-00-00-000Z')
      expect(
        await readFile(join(tempDir, 'opencove.db.corrupt-2026-02-28T00-00-00-000Z'), 'utf8'),
      ).toBe('corrupt-db')
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'measures workspace state payload size in UTF-8 bytes',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const mockDbByPath = new Map<string, MockDbState>()
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const raw = JSON.stringify({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: { label: '中😀' },
      })
      const rawBytes = Buffer.byteLength(raw, 'utf8')
      expect(rawBytes).toBeGreaterThan(raw.length)

      const oversizedStore = await createPersistenceStore({
        dbPath: join(tempDir, 'oversized.db'),
        maxRawBytes: raw.length,
      })
      const oversizedResult = await oversizedStore.writeWorkspaceStateRaw(raw)
      expect(oversizedResult).toEqual({
        ok: false,
        reason: 'payload_too_large',
        error: {
          code: 'persistence.payload_too_large',
          params: {
            bytes: rawBytes,
            maxBytes: raw.length,
          },
          debugMessage: `Workspace state payload too large to persist (${rawBytes} bytes).`,
        },
      })
      oversizedStore.dispose()

      const store = await createPersistenceStore({
        dbPath: join(tempDir, 'opencove.db'),
        maxRawBytes: rawBytes,
      })

      const result = await store.writeWorkspaceStateRaw(raw)
      expect(result).toMatchObject({ ok: true, level: 'full', bytes: rawBytes })
      if (result.ok) {
        expect(result.revision).toBeTypeOf('number')
        expect(result.revision).toBeGreaterThan(0)
      }
      store.dispose()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'rejects overwriting existing workspace state with an automatic empty workspace list',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>([
        [
          dbPath,
          createMockDbState({
            currentState: {
              formatVersion: 1,
              activeWorkspaceId: 'workspace-1',
              workspaces: [
                {
                  id: 'workspace-1',
                  name: 'Workspace 1',
                  path: '/tmp/workspace-1',
                  worktreesRoot: '/tmp',
                  pullRequestBaseBranchOptions: [],
                  environmentVariables: {},
                  spaceArchiveRecords: [],
                  viewport: { x: 0, y: 0, zoom: 1 },
                  isMinimapVisible: true,
                  spaces: [],
                  activeSpaceId: null,
                  nodes: [],
                },
              ],
              settings: {},
            },
          }),
        ],
      ])
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      const result = await store.writeAppState({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: {},
      })

      expect(result.ok).toBe(false)
      expect(result.ok ? result.level : null).toBeNull()
      expect(result).toMatchObject({
        ok: false,
        reason: 'unknown',
        error: {
          code: 'persistence.invalid_state',
        },
      })

      store.dispose()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )

  it(
    'allows an explicit empty workspace overwrite when requested',
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'cove-persist-'))
      const dbPath = join(tempDir, 'opencove.db')
      const mockDbByPath = new Map<string, MockDbState>([
        [
          dbPath,
          createMockDbState({
            currentState: {
              formatVersion: 1,
              activeWorkspaceId: 'workspace-1',
              workspaces: [
                {
                  id: 'workspace-1',
                  name: 'Workspace 1',
                  path: '/tmp/workspace-1',
                  worktreesRoot: '/tmp',
                  pullRequestBaseBranchOptions: [],
                  environmentVariables: {},
                  spaceArchiveRecords: [],
                  viewport: { x: 0, y: 0, zoom: 1 },
                  isMinimapVisible: true,
                  spaces: [],
                  activeSpaceId: null,
                  nodes: [],
                },
              ],
              settings: {},
            },
          }),
        ],
      ])
      vi.doMock('better-sqlite3', () => ({ default: createMockDatabaseModule(mockDbByPath) }))

      const { createPersistenceStore } =
        await import('../../../src/platform/persistence/sqlite/PersistenceStore')

      const store = await createPersistenceStore({ dbPath })
      const result = await store.writeAppState(
        {
          formatVersion: 1,
          activeWorkspaceId: null,
          workspaces: [],
          settings: {},
        },
        { allowEmptyWorkspaceOverwrite: true },
      )

      expect(result).toMatchObject({ ok: true, level: 'full' })
      store.dispose()
    },
    PERSISTENCE_STORE_TEST_TIMEOUT_MS,
  )
})
