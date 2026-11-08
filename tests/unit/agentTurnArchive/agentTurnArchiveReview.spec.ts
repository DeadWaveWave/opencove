// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerAgentTurnArchiveRuntime } from '../../../src/app/main/controlSurface/agentTurnArchiveRuntime'
import { createAgentTurnArchive } from '../../../src/contexts/agent/application/createAgentTurnArchive'
import { validateArchiveBookkeeping } from '../../../src/contexts/agent/infrastructure/turnArchive/archiveSchema'
import type Database from 'better-sqlite3'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { endedTurn } from '../../support/agentTurnArchive/agentTurnArchiveContract'

const snapshot = (ids: string[]) => ({ workspaces: [{ id: 'w', nodes: ids.map(id => ({ id })) }] })

describe('archive review regressions', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps a turn appended while an older membership read is pending', async () => {
    vi.useFakeTimers()
    const archive = new InMemoryAgentTurnArchive()
    let state = snapshot(['old'])
    let release: (() => void) | undefined
    let defer = false
    const persistence = {
      readAppState: async () => {
        const captured = state
        if (defer) {
          await new Promise<void>(resolve => {
            release = resolve
          })
        }
        return captured
      },
    } as unknown as PersistenceStore
    const runtime = createWorkerAgentTurnArchiveRuntime({
      enabled: true,
      userDataPath: '/profile',
      getPersistenceStore: async () => persistence,
      open: () => archive,
    })
    await runtime.start()
    defer = true
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(release).toBeTypeOf('function')
    state = snapshot(['old', 'new']) // Durable commit while the captured read is pending.
    expect(archive.append(endedTurn({ nodeId: 'new' }))).toEqual({ status: 'persisted' })
    release!()
    await vi.advanceTimersByTimeAsync(0)
    expect(archive.getExact({ nodeId: 'new', turnId: 'turn' })).toMatchObject({ status: 'found' })
    runtime.dispose()
  })

  it('rejects unknown and deleted durable ownership on both exact selectors', () => {
    let membership: ReadonlySet<string> | null = null
    const fake = new InMemoryAgentTurnArchive({
      membership: id =>
        membership === null ? 'unknown' : membership.has(id) ? 'member' : 'absent',
    })
    fake.append(endedTurn())
    expect(fake.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'unavailable' })
    membership = new Set(['node'])
    expect(fake.getExact({ nodeId: 'node', turnId: 'turn' })).toMatchObject({ status: 'found' })
    membership = new Set()
    expect(fake.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'absent' })
    expect(fake.getExactBySession({ sessionId: 'original-session', turnId: 'turn' })).toEqual({
      status: 'absent',
    })
    fake.dispose()
  })

  it('still deletes storage rows when the run-local revocation fence overflows', () => {
    const revokeNodes = vi.fn()
    const storage = { revokeNodes, dispose: vi.fn() } as never
    const archive = createAgentTurnArchive(storage)
    const ids = Array.from({ length: 20_001 }, (_, i) => `n${i}`)
    archive.revokeNodes(ids)
    expect(revokeNodes).toHaveBeenCalledWith(ids)
  })

  it.each([{ id: 2 }, { next_seq: 1 }, { record_count: 0 }, { message_bytes: 0 }])(
    'rejects inconsistent schema bookkeeping %j without writing',
    broken => {
      const schema = {
        id: 1,
        version: 1,
        next_seq: 2,
        record_count: 1,
        message_bytes: 5,
        ...broken,
      }
      const db = {
        prepare: vi.fn((sql: string) => ({
          all: () => [schema],
          get: () =>
            sql.includes('ended_turns')
              ? { max_seq: 1, record_count: 1, message_bytes: 5 }
              : schema,
        })),
      } as unknown as Database.Database
      expect(validateArchiveBookkeeping).toBeTypeOf('function')
      expect(() => validateArchiveBookkeeping(db)).toThrow()
    },
  )
})

it('updates read authority only after successful durable writes, including raw writes', async () => {
  const archive = new InMemoryAgentTurnArchive()
  let raw = snapshot(['node'])
  const persistence = {
    readAppState: async () => raw,
    writeAppState: vi.fn(async (next: typeof raw, opts?: { expectedRevision?: number }) => {
      if (opts?.expectedRevision === -1) {
        return { ok: false }
      }
      raw = next
      return { ok: true }
    }),
    writeWorkspaceStateRaw: vi.fn(async (next: string) => {
      raw = JSON.parse(next)
      return { ok: true }
    }),
  } as unknown as PersistenceStore
  const runtime = createWorkerAgentTurnArchiveRuntime({
    enabled: true,
    userDataPath: '/profile',
    getPersistenceStore: async () => persistence,
    open: () => archive,
  })
  expect(runtime.port.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({
    status: 'unavailable',
  })
  await runtime.start()
  archive.append(endedTurn())
  const store = await runtime.getPersistenceStore()
  await store.writeAppState(snapshot([]), { expectedRevision: -1 })
  expect(runtime.port.getExact({ nodeId: 'node', turnId: 'turn' })).toMatchObject({
    status: 'found',
  })
  await store.writeAppState(snapshot([]))
  expect(runtime.port.getExactBySession({ sessionId: 'original-session', turnId: 'turn' })).toEqual(
    { status: 'absent' },
  )
  await store.writeWorkspaceStateRaw(JSON.stringify(snapshot(['node'])))
  expect(runtime.port.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'absent' }) // UUID reuse does not restore deleted rows.
  runtime.dispose()
})

it('finishes startup orphan cleanup in yielding batches before the periodic interval', async () => {
  const archive = new InMemoryAgentTurnArchive()
  const survivors = Array.from({ length: 256 }, (_, i) => `survivor-${i}`)
  for (const nodeId of [...survivors, 'deleted']) {
    archive.append(endedTurn({ nodeId }))
  }
  const sweep = vi.spyOn(archive, 'sweep')
  const runtime = createWorkerAgentTurnArchiveRuntime({
    enabled: true,
    userDataPath: '/profile',
    getPersistenceStore: async () =>
      ({ readAppState: async () => snapshot(survivors) }) as unknown as PersistenceStore,
    open: () => archive,
  })
  await runtime.start()
  expect(sweep).toHaveBeenCalledTimes(2)
  expect(archive.getExact({ nodeId: 'deleted', turnId: 'turn' })).toEqual({ status: 'absent' })
  runtime.dispose()
})

it('preserves newer durable membership when a pre-commit snapshot resolves late', async () => {
  vi.useFakeTimers()
  const archive = new InMemoryAgentTurnArchive()
  let state = snapshot(['old'])
  let deferred = false
  let release!: () => void
  const persistence = {
    readAppState: async () => {
      const captured = state
      if (deferred) {
        await new Promise<void>(resolve => {
          release = resolve
        })
      }
      return captured
    },
    writeAppState: async (next: typeof state) => {
      state = next
      return { ok: true }
    },
  } as unknown as PersistenceStore
  const runtime = createWorkerAgentTurnArchiveRuntime({
    enabled: true,
    userDataPath: '/profile',
    getPersistenceStore: async () => persistence,
    open: () => archive,
  })
  try {
    await runtime.start()
    deferred = true
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    await (await runtime.getPersistenceStore()).writeAppState(snapshot(['new']))
    archive.append(endedTurn({ nodeId: 'new' }))
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(runtime.port.getExact({ nodeId: 'new', turnId: 'turn' })).toMatchObject({
      status: 'found',
    })
  } finally {
    runtime.dispose()
    vi.useRealTimers()
  }
})
