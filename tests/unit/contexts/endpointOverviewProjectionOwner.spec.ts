import { setImmediate as flush } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { EndpointOverviewProjectionOwner } from '../../../src/contexts/topology/presentation/renderer/EndpointOverviewProjectionOwner'
import type { WorkerEndpointOverviewDto } from '../../../src/shared/contracts/dto'

function overview(
  phase: 'installing_runtime' | 'starting_runtime' | null = 'installing_runtime',
  revision = 1,
): WorkerEndpointOverviewDto {
  return {
    endpoint: {
      endpointId: 'managed-1',
      kind: 'remote_worker',
      displayName: 'Test',
      createdAt: '',
      updatedAt: '',
      access: null,
      remote: null,
    },
    status: phase ? 'connecting' : 'connected',
    summary: '',
    details: [],
    checkedAt: '',
    isManaged: true,
    canBrowse: !phase,
    dependentMountCount: 0,
    recommendedAction: phase ? 'show_details' : 'browse',
    runtime: { appVersion: null, protocolVersion: null, platform: null, pid: null },
    operation: phase
      ? {
          operationId: 'operation-1',
          revision,
          kind: 'prepare',
          phase,
          startedAt: '2026-09-04T12:00:00Z',
          updatedAt: '2026-09-04T12:00:00Z',
        }
      : null,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function harness() {
  const timers = new Set<() => void>()
  const list = vi.fn(async () => [overview(null)])
  const prepare = vi.fn(async () => overview())
  const owner = new EndpointOverviewProjectionOwner({
    port: { list, prepare, repair: prepare },
    formatError: error => String(error),
    schedule: (callback, delay) => {
      expect(delay).toBe(500)
      timers.add(callback)
      return () => {
        timers.delete(callback)
      }
    },
  })
  const tick = () => {
    const current = [...timers]
    timers.clear()
    current.forEach(callback => callback())
  }
  return { owner, list, prepare, timers, tick }
}

describe('EndpointOverviewProjectionOwner', () => {
  it('shares initial observation, polls only active operations and stops on final result', async () => {
    const h = harness()
    const release = h.owner.acquire()
    const releaseSecond = h.owner.acquire()
    await flush()
    expect(h.list).toHaveBeenCalledTimes(1)
    expect(h.timers.size).toBe(0)
    await h.owner.prepareEndpoint({ endpointId: 'managed-1' })
    expect(h.owner.getSnapshot().busyByEndpointId['managed-1']).toBe('prepare')
    expect(h.timers.size).toBe(1)
    h.tick()
    await flush()
    expect(h.owner.getSnapshot().overviews[0]?.status).toBe('connected')
    expect(h.owner.getSnapshot().busyByEndpointId['managed-1']).toBeUndefined()
    expect(h.timers.size).toBe(0)
    release()
    releaseSecond()
    h.owner.dispose()
  })

  it('does not overlap queries or regress a newer accepted operation with an old query', async () => {
    const h = harness()
    const first = deferred<WorkerEndpointOverviewDto[]>()
    h.list.mockImplementationOnce(async () => await first.promise)
    const release = h.owner.acquire()
    await h.owner.prepareEndpoint({ endpointId: 'managed-1' })
    first.resolve([overview(null)])
    await flush()
    expect(h.owner.getSnapshot().overviews[0]?.operation?.operationId).toBe('operation-1')
    const second = deferred<WorkerEndpointOverviewDto[]>()
    h.list.mockImplementationOnce(async () => await second.promise)
    h.tick()
    h.tick()
    expect(h.list).toHaveBeenCalledTimes(2)
    expect(h.timers.size).toBe(0)
    second.resolve([overview('starting_runtime', 3)])
    await flush()
    h.list.mockResolvedValueOnce([overview('installing_runtime', 2)])
    h.tick()
    await flush()
    expect(h.owner.getSnapshot().overviews[0]?.operation?.revision).toBe(3)
    release()
    h.owner.dispose()
  })

  it('retains operation truth after observation failure and resumes on reopen without cancelling work', async () => {
    const h = harness()
    let release = h.owner.acquire()
    await flush()
    await h.owner.prepareEndpoint({ endpointId: 'managed-1' })
    h.list.mockRejectedValueOnce(new Error('monitor disconnected'))
    h.tick()
    await flush()
    expect(h.owner.getSnapshot().overviews[0]?.operation).toBeTruthy()
    expect(h.owner.getSnapshot().error).toContain('monitor disconnected')
    release()
    expect(h.timers.size).toBe(0)
    h.list.mockResolvedValueOnce([overview('starting_runtime', 4)])
    release = h.owner.acquire()
    await flush()
    expect(h.owner.getSnapshot().overviews[0]?.operation?.revision).toBe(4)
    expect(h.prepare).toHaveBeenCalledTimes(1)
    release()
    h.owner.dispose()
  })

  it('does not apply a query during acceptance or resurrect a removed endpoint from late acceptance', async () => {
    const h = harness()
    const release = h.owner.acquire()
    await flush()
    const acceptance = deferred<WorkerEndpointOverviewDto>()
    h.prepare.mockImplementationOnce(async () => await acceptance.promise)
    const command = h.owner.prepareEndpoint({ endpointId: 'managed-1' })
    h.list.mockResolvedValueOnce([overview('starting_runtime', 7)])
    await h.owner.reload()
    expect(h.owner.getSnapshot().overviews[0]?.operation).toBeNull()
    h.list.mockResolvedValue([])
    h.owner.topologyChanged()
    acceptance.resolve(overview())
    await command
    await h.owner.reload()
    expect(h.owner.getSnapshot().overviews).toEqual([])
    release()
    h.owner.dispose()
  })

  it('serializes requested reloads so callers get a post-change query', async () => {
    const h = harness()
    const first = deferred<WorkerEndpointOverviewDto[]>()
    h.list.mockImplementationOnce(async () => await first.promise)
    const release = h.owner.acquire()
    const reload = h.owner.reload()
    expect(h.list).toHaveBeenCalledTimes(1)
    first.resolve([])
    await reload
    expect(h.list).toHaveBeenCalledTimes(2)
    expect(h.owner.getSnapshot().overviews).toHaveLength(1)
    release()
    h.owner.dispose()
  })
})
