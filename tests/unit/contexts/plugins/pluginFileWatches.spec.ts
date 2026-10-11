// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { PluginFileWatches } from '../../../../src/contexts/plugins/application/PluginFileWatches'
import type {
  PluginHostAuthority,
  PluginResolvedTarget,
} from '../../../../src/contexts/plugins/domain/pluginHostTypes'
const target: PluginResolvedTarget = {
  projectId: 'p',
  spaceId: null,
  mountId: 'm',
  endpointId: 'local',
  rootUri: 'file:///repo',
  cwdUri: 'file:///repo',
  workingDirectory: '/repo',
}
const authority = (ownerId = 'owner'): PluginHostAuthority => ({ ownerId, assertActive() {} })
function fixture() {
  let clock = 0,
    sequence = 0
  const sample = vi.fn(
    async () =>
      new Map([
        ['src', 'directory'],
        ['src/a.ts', 'v1'],
      ]),
  )
  const watches = new PluginFileWatches(
    { sample },
    () => `${++sequence}`,
    () => clock,
  )
  return {
    sample,
    watches,
    tick: () => {
      clock += 1000
    },
  }
}
describe('plugin file watch generation and bounded sampling', () => {
  it('samples on demand and returns relative changes, without repeating or background work', async () => {
    const { sample, watches, tick } = fixture()
    const { watchId } = await watches.create(authority(), target, 'src')
    expect(await watches.read(authority(), watchId)).toMatchObject({
      events: [],
      retryAfterMs: 1000,
    })
    expect(sample).toHaveBeenCalledTimes(1)
    tick()
    sample.mockResolvedValue(
      new Map([
        ['src', 'directory'],
        ['src/b.ts', 'v2'],
      ]),
    )
    expect(await watches.read(authority(), watchId)).toMatchObject({
      sequence: 1,
      events: [
        { type: 'created', path: 'src/b.ts' },
        { type: 'deleted', path: 'src/a.ts' },
      ],
    })
    expect(await watches.read(authority(), watchId)).toMatchObject({ events: [], sequence: 1 })
    expect(sample).toHaveBeenCalledTimes(2)
    watches.remove(authority(), watchId)
    await expect(watches.read(authority(), watchId)).rejects.toThrow('unavailable')
  })
  it('isolates owners and retires pending sampling before it can publish', async () => {
    const { sample, watches, tick } = fixture()
    const { watchId } = await watches.create(authority(), target, '.')
    await expect(watches.read(authority('other'), watchId)).rejects.toThrow('unavailable')
    tick()
    let complete!: (value: Map<string, string>) => void
    sample.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve
        }),
    )
    const pending = watches.read(authority(), watchId)
    expect(await watches.read(authority(), watchId)).toMatchObject({ events: [] })
    expect(sample).toHaveBeenCalledTimes(2)
    watches.retire('owner')
    complete(new Map())
    await expect(pending).rejects.toThrow('disposed')
    await expect(watches.read(authority(), watchId)).rejects.toThrow('unavailable')
  })
  it('bounds owner admission including pending watches and truncates large event batches', async () => {
    const { sample, watches, tick } = fixture()
    const first = await watches.create(authority(), target, '.')
    await Promise.all(Array.from({ length: 3 }, () => watches.create(authority(), target, '.')))
    await expect(watches.create(authority(), target, '.')).rejects.toThrow('Too many')
    sample.mockResolvedValue(new Map(Array.from({ length: 256 }, (_, i) => [`new-${i}`, 'file'])))
    tick()
    const result = await watches.read(authority(), first.watchId)
    expect(result.events).toHaveLength(256)
    expect(result.truncated).toBe(true)
    watches.retire('owner')
    await expect(watches.create(authority(), target, '.')).resolves.toHaveProperty('watchId')
  })
  it('retains previous snapshot after a failed sample and never coalesces concurrent reads', async () => {
    const { sample, watches, tick } = fixture()
    const { watchId } = await watches.create(authority(), target, '.')
    tick()
    sample.mockRejectedValueOnce(new Error('Worker offline'))
    await expect(watches.read(authority(), watchId)).rejects.toThrow('offline')
    tick()
    sample.mockResolvedValue(
      new Map([
        ['src', 'directory'],
        ['src/a.ts', 'v2'],
      ]),
    )
    expect(await watches.read(authority(), watchId)).toMatchObject({
      events: [{ type: 'changed', path: 'src/a.ts' }],
    })
  })
})

it('retirement during initial admission frees reserved slots and cannot resurrect a handle', async () => {
  const { sample, watches } = fixture()
  let finish!: (value: Map<string, string>) => void
  sample.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const pending = watches.create(authority(), target, '.')
  watches.retire('owner')
  finish(new Map())
  await expect(pending).rejects.toThrow('disposed')
  await Promise.all(
    Array.from({ length: 4 }, () =>
      expect(watches.create(authority(), target, '.')).resolves.toHaveProperty('watchId'),
    ),
  )
})
