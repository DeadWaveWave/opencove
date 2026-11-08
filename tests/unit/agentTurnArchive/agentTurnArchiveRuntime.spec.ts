// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerAgentTurnArchiveRuntime } from '../../../src/app/main/controlSurface/agentTurnArchiveRuntime'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { endedTurn } from '../../support/agentTurnArchive/agentTurnArchiveContract'

function store(readAppState: () => Promise<unknown> = vi.fn(async () => null)) {
  return { readAppState } as unknown as PersistenceStore
}

describe('Worker ended-turn archive lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens only after persistence bootstrap, sweeps periodically and disposes once', async () => {
    vi.useFakeTimers()
    const archive = new InMemoryAgentTurnArchive()
    const sweep = vi.spyOn(archive, 'sweep')
    const dispose = vi.spyOn(archive, 'dispose')
    const checkpoint = vi.spyOn(archive, 'checkpoint')
    const read = vi.fn(async () => null)
    const open = vi.fn(() => {
      expect(read).toHaveBeenCalledOnce()
      return archive
    })
    const runtime = createWorkerAgentTurnArchiveRuntime({
      enabled: true,
      userDataPath: '/profile',
      getPersistenceStore: async () => store(read),
      open,
    })
    expect(runtime.port.append(endedTurn())).toEqual({
      status: 'memory_only',
      reason: 'unavailable',
    })
    await runtime.start()
    await runtime.start()
    expect(open).toHaveBeenCalledExactlyOnceWith({
      userDataPath: '/profile',
      membership: expect.any(Function),
    })
    expect(sweep).toHaveBeenCalledOnce()
    expect(runtime.port.append(endedTurn())).toEqual({ status: 'persisted' })
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(sweep).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(3)
    runtime.stop()
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(sweep).toHaveBeenCalledTimes(2)
    expect(dispose).not.toHaveBeenCalled()
    runtime.dispose()
    runtime.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect(checkpoint).toHaveBeenCalledTimes(3) // Startup, periodic cycle, shutdown.
  })

  it('refreshes durable nodes for periodic orphan cleanup', async () => {
    vi.useFakeTimers()
    const archive = new InMemoryAgentTurnArchive()
    const sweep = vi.spyOn(archive, 'sweep')
    let nodeId = 'old-node'
    const runtime = createWorkerAgentTurnArchiveRuntime({
      enabled: true,
      userDataPath: '/profile',
      open: () => archive,
      getPersistenceStore: async () =>
        store(async () => ({
          formatVersion: 1,
          workspaces: [{ id: 'workspace', nodes: [{ id: nodeId }] }],
        })),
    })
    await runtime.start()
    expect(sweep.mock.calls[0][1]).toEqual(new Set(['old-node']))
    nodeId = 'new-node'
    runtime.port.append(endedTurn({ nodeId }))
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(sweep.mock.calls[1][1]).toEqual(new Set(['new-node']))
    expect(runtime.port.getExact({ nodeId, turnId: 'turn' })).toMatchObject({ status: 'found' })
    runtime.dispose()
  })

  it('stays disabled when bootstrap fails or the boundary is off', async () => {
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const open = vi.fn(() => new InMemoryAgentTurnArchive())
    await Promise.all(
      [true, false].map(async enabled => {
        const runtime = createWorkerAgentTurnArchiveRuntime({
          enabled,
          userDataPath: '/profile',
          getPersistenceStore: async () => {
            throw new Error('private bootstrap error')
          },
          open,
        })
        await runtime.start()
        expect(runtime.port.append(endedTurn())).toEqual({
          status: 'memory_only',
          reason: 'unavailable',
        })
        runtime.dispose()
      }),
    )
    expect(open).not.toHaveBeenCalled()
    expect(diagnostic).toHaveBeenCalledWith('[opencove] ended-turn archive startup unavailable.\n')
  })

  it('does not open after shutdown crosses a persistence await', async () => {
    let release!: (value: PersistenceStore) => void
    const pending = new Promise<PersistenceStore>(resolve => {
      release = resolve
    })
    const open = vi.fn(() => new InMemoryAgentTurnArchive())
    const runtime = createWorkerAgentTurnArchiveRuntime({
      enabled: true,
      userDataPath: '/profile',
      getPersistenceStore: () => pending,
      open,
    })
    const started = runtime.start()
    runtime.dispose()
    release(store())
    await started
    expect(open).not.toHaveBeenCalled()
  })

  it('closes an archive that finishes opening after shutdown', async () => {
    vi.useFakeTimers()
    const archive = new InMemoryAgentTurnArchive()
    const dispose = vi.spyOn(archive, 'dispose')
    let release!: () => void
    const opening = new Promise<void>(resolve => {
      release = resolve
    })
    const open = vi.fn(async () => {
      await opening
      return archive
    })
    const runtime = createWorkerAgentTurnArchiveRuntime({
      enabled: true,
      userDataPath: '/profile',
      getPersistenceStore: async () => store(),
      open,
    })
    const started = runtime.start()
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    runtime.dispose()
    release()
    await started
    expect(dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
