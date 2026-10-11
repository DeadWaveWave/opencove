// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PluginTargetOperations,
  type PluginOperationPort,
} from '../../../../src/contexts/plugins/application/PluginTargetOperations'
import type { PluginResolvedTarget } from '../../../../src/contexts/plugins/domain/pluginHostTypes'
const target: PluginResolvedTarget = {
  projectId: 'p',
  spaceId: null,
  mountId: 'm',
  endpointId: 'local',
  rootUri: 'file:///repo',
  cwdUri: 'file:///repo',
  workingDirectory: '/repo',
}
afterEach(() => vi.useRealTimers())
function fixture() {
  vi.useFakeTimers()
  let index = 0
  const snapshot = {
    output: 'progress',
    truncated: false,
    exitCode: null as number | null,
    exited: false,
  }
  const port: PluginOperationPort = {
    spawn: vi.fn(async () => `session-${++index}`),
    snapshot: () => snapshot,
    kill: vi.fn(),
    forget: vi.fn(),
  }
  const owner = new PluginTargetOperations(port, () => `op-${index}`)
  const authority = { ownerId: 'a', assertActive: vi.fn() }
  return { snapshot, port, owner, authority }
}
describe('target job lifecycle', () => {
  it('keeps bounded progress, observes exit, and prevents cross-owner access', async () => {
    const f = fixture()
    const op = f.owner.start(f.authority, target, 'tool', [], 30_000)
    await vi.advanceTimersByTimeAsync(100)
    expect(f.owner.get('a', op.operationId)).toMatchObject({
      status: 'running',
      output: 'progress',
    })
    expect(() => f.owner.get('b', op.operationId)).toThrow('unavailable')
    f.snapshot.output = '界'.repeat(100_000)
    await vi.advanceTimersByTimeAsync(100)
    const tail = f.owner.get('a', op.operationId).output
    expect(new TextEncoder().encode(tail).byteLength).toBeLessThanOrEqual(256 * 1024)
    expect(tail).not.toContain('�')
    f.snapshot.output = 'x'.repeat(300_000)
    f.snapshot.exitCode = 7
    f.snapshot.exited = true
    await vi.advanceTimersByTimeAsync(100)
    expect(f.owner.get('a', op.operationId)).toMatchObject({
      status: 'completed',
      exitCode: 7,
      truncated: true,
    })
    expect(f.owner.get('a', op.operationId).output.length).toBe(256 * 1024)
    expect(f.port.forget).toHaveBeenCalledWith('session-1')
    await f.owner.retire('a')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels only its owned session and reports unconfirmed remote cancellation honestly', async () => {
    const f = fixture()
    const op = f.owner.start(f.authority, { ...target, endpointId: 'remote' }, 'tool', [], 100)
    await vi.advanceTimersByTimeAsync(101)
    expect(f.owner.get('a', op.operationId).status).toBe('cancelling')
    expect(f.port.kill).toHaveBeenCalledExactlyOnceWith('session-1')
    await vi.advanceTimersByTimeAsync(5100)
    expect(f.owner.get('a', op.operationId)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('did not confirm'),
    })
    await f.owner.retire('a')
  })
  it('kills late spawns after the view is closed without reactivating a retired job', async () => {
    const f = fixture()
    let resolve!: (id: string) => void
    f.port.spawn = vi.fn(
      () =>
        new Promise(accept => {
          resolve = accept
        }),
    )
    const op = f.owner.start(f.authority, target, 'tool', [], 30_000)
    await f.owner.retire('a')
    resolve('late-session')
    await vi.advanceTimersByTimeAsync(1)
    expect(f.port.kill).toHaveBeenCalledExactlyOnceWith('late-session')
    f.snapshot.exited = true
    f.snapshot.exitCode = 0
    await vi.advanceTimersByTimeAsync(100)
    expect(() => f.owner.get('a', op.operationId)).toThrow('unavailable')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('enforces pending operation capacity even before spawns resolve', async () => {
    const f = fixture()
    let id = 0
    const owner = new PluginTargetOperations(
      { ...f.port, spawn: async () => new Promise(() => {}) },
      () => `${++id}`,
    )
    for (let n = 0; n < 4; n++) {
      owner.start(f.authority, target, 'tool', [], 30_000)
    }
    expect(() => owner.start(f.authority, target, 'tool', [], 30_000)).toThrow('Too many')
    await owner.retire('a')
    await vi.advanceTimersByTimeAsync(5100)
    expect(vi.getTimerCount()).toBe(0)
  })
})
