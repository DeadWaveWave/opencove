import { describe, expect, it, vi } from 'vitest'
import {
  PluginStateObservations,
  type PluginObservationSnapshot,
} from '../../../src/contexts/plugins/application/PluginStateObservations'
import type { PluginHostAuthority } from '../../../src/contexts/plugins/domain/pluginHostTypes'

function fixture() {
  let time = 1000,
    counter = 0
  let data: PluginObservationSnapshot = new Map([['node', new Map([['first', 'v1']])]])
  const snapshot = vi.fn(async () => data)
  const authority: PluginHostAuthority = {
    ownerId: 'one',
    pluginId: 'plugin',
    assertActive: vi.fn(),
  }
  const observations = new PluginStateObservations(
    snapshot,
    () => String(++counter),
    () => time,
  )
  return {
    observations,
    snapshot,
    authority,
    advance: () => {
      time += 300
    },
    expire: () => {
      time += 120_001
    },
    set: (value: PluginObservationSnapshot) => {
      data = value
    },
  }
}

describe('plugin sampled state subscriptions', () => {
  it('establishes a baseline, coalesces changes, and never replays a delivered batch', async () => {
    const f = fixture()
    const { subscriptionId } = await f.observations.subscribe(f.authority, 'project', ['node'])
    expect(await f.observations.poll(f.authority, subscriptionId)).toMatchObject({
      sequence: 0,
      changes: [],
    })
    expect(f.snapshot).toHaveBeenCalledTimes(1)
    f.set(new Map([['node', new Map([['second', 'v2']])]]))
    f.advance()
    expect(await f.observations.poll(f.authority, subscriptionId)).toMatchObject({
      sequence: 1,
      changes: [
        { type: 'node', id: 'first', change: 'removed' },
        { type: 'node', id: 'second', change: 'created' },
      ],
    })
    f.advance()
    expect(await f.observations.poll(f.authority, subscriptionId)).toMatchObject({
      sequence: 1,
      changes: [],
    })
  })

  it('bounds one owner, the worker, and output batches', async () => {
    const f = fixture()
    const ids = await Promise.all(
      Array.from({ length: 4 }, () => f.observations.subscribe(f.authority, 'project', ['node'])),
    )
    await expect(f.observations.subscribe(f.authority, 'project', ['node'])).rejects.toThrow(
      'limit',
    )
    await Promise.all(
      Array.from({ length: 28 }, (_, i) =>
        f.observations.subscribe({ ...f.authority, ownerId: `owner-${i}` }, 'project', ['node']),
      ),
    )
    await expect(
      f.observations.subscribe({ ...f.authority, ownerId: 'extra' }, 'project', ['node']),
    ).rejects.toThrow('limit')
    f.set(
      new Map([['node', new Map(Array.from({ length: 105 }, (_, i) => [`id-${i}`, 'changed']))]]),
    )
    f.advance()
    const batch = await f.observations.poll(f.authority, ids[0].subscriptionId)
    expect(batch.changes).toHaveLength(100)
    expect(batch.truncated).toBe(true)
    f.advance()
    expect((await f.observations.poll(f.authority, ids[0].subscriptionId)).changes).toEqual([])
  })

  it('scopes identities and expires or retires leases without replay', async () => {
    const f = fixture()
    const { subscriptionId } = await f.observations.subscribe(f.authority, 'project', ['node'])
    await expect(
      f.observations.poll({ ...f.authority, ownerId: 'other' }, subscriptionId),
    ).rejects.toThrow('unavailable')
    f.expire()
    await expect(f.observations.poll(f.authority, subscriptionId)).rejects.toThrow('expired')
    const next = await f.observations.subscribe(f.authority, 'project', ['node'])
    f.observations.retire(f.authority.ownerId)
    await expect(f.observations.poll(f.authority, next.subscriptionId)).rejects.toThrow(
      'unavailable',
    )
  })

  it('reserves capacity before asynchronous baselines and rejects stale replies after retirement', async () => {
    const f = fixture()
    let release!: (snapshot: PluginObservationSnapshot) => void
    f.snapshot.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve
        }),
    )
    const first = f.observations.subscribe(f.authority, 'project', ['node'])
    f.observations.retire(f.authority.ownerId)
    release(new Map())
    await expect(first).rejects.toThrow('unavailable')
    f.snapshot.mockResolvedValue(new Map())
    const { subscriptionId } = await f.observations.subscribe(f.authority, 'project', ['node'])
    f.advance()
    f.snapshot.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve
        }),
    )
    const pending = f.observations.poll(f.authority, subscriptionId)
    await expect(f.observations.poll(f.authority, subscriptionId)).rejects.toThrow('one poll')
    f.observations.dispose(f.authority, subscriptionId)
    release(new Map())
    await expect(pending).rejects.toThrow('unavailable')
  })
})
