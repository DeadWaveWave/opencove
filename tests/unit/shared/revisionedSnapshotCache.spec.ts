import { describe, expect, it, vi } from 'vitest'
import {
  RevisionedSnapshotCache,
  writeRevisionedSnapshot,
} from '@shared/sync/revisionedSnapshotCache'
import { mergeValue } from '@shared/sync/mergeValue'

describe('revisioned publication', () => {
  function setup(local = { title: 'old', x: 1 }) {
    const cache = new RevisionedSnapshotCache<typeof local>()
    cache.set(1, { title: 'old', x: 0 })
    cache.set(2, { title: 'external', x: 0 })
    const write = vi.fn().mockRejectedValueOnce('conflict').mockResolvedValue(3)
    return {
      cache,
      baseRevision: 1,
      state: local,
      write,
      read: vi.fn(async () => ({ revision: 2, state: { title: 'external', x: 0 } })),
      normalize: (v: unknown) => v as typeof local,
      merge: (r: typeof local, l: typeof local, a: typeof local | null) => mergeValue(r, l, a)!,
      isConflict: (e: unknown) => e === 'conflict',
    }
  }
  it('uses the requested ancestor after a newer read and retries CAS', async () => {
    const options = setup()
    expect(await writeRevisionedSnapshot(options)).toMatchObject({ revision: 3, merged: true })
    expect(options.write.mock.calls).toEqual([
      [{ title: 'old', x: 1 }, 1],
      [{ title: 'external', x: 1 }, 2],
    ])
  })
  it('does not write a content-identical merge', async () => {
    const options = setup({ title: 'old', x: 0 })
    expect(await writeRevisionedSnapshot(options)).toMatchObject({ revision: 2, merged: true })
    expect(options.write).toHaveBeenCalledTimes(1)
  })
  it('bounds retries', async () => {
    const options = setup()
    options.write.mockReset().mockRejectedValue('conflict')
    await expect(writeRevisionedSnapshot(options)).rejects.toBe('conflict')
    expect(options.write).toHaveBeenCalledTimes(3)
  })
  it('bounds cache and falls back for evicted ancestors', async () => {
    const options = setup()
    for (let i = 3; i <= 18; i++) {
      options.cache.set(i, { title: 'old', x: 0 })
    }
    expect(options.cache.get(1)).toBeUndefined()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await writeRevisionedSnapshot(options)
    expect(options.write.mock.calls[0][1]).toBe(18)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
