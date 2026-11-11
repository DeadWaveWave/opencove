import { describe, expect, it, vi } from 'vitest'
import {
  RevisionedSnapshotCache,
  writeRevisionedSnapshot,
} from '@shared/sync/revisionedSnapshotCache'

describe('canonical snapshot receipts', () => {
  it('retains latest on delayed reads and rejects unequal content at equal revision', () => {
    const cache = new RevisionedSnapshotCache<string>()
    cache.set(3, 'B')
    cache.set(2, 'A')
    expect(cache.latest).toEqual({ revision: 3, state: 'B' })
    expect(() => cache.set(3, 'C')).toThrow()
    expect(cache.get(3)).toBe('B')
  })
  it.each([true, undefined])(
    'does not cache corrected or unattested candidate (%s)',
    async corrected => {
      const cache = new RevisionedSnapshotCache<string>()
      cache.set(1, 'base')
      const write = vi.fn(async () => ({ revision: 2, corrected }))
      const result = await writeRevisionedSnapshot({
        cache,
        state: 'stale',
        write,
        read: async () => ({ revision: 3, state: 'canonical' }),
        normalize: value => value as string,
        merge: latest => latest,
        isConflict: () => false,
      })
      expect(result).toMatchObject({ revision: 2, merged: true })
      expect(cache.get(2)).toBeUndefined()
      expect(write).toHaveBeenCalledOnce()
    },
  )
  it('caches an explicitly unchanged normalized success', async () => {
    const cache = new RevisionedSnapshotCache<string>()
    await writeRevisionedSnapshot({
      cache,
      preflight: false,
      state: 'value',
      write: async () => ({ revision: 2, corrected: false }),
      read: vi.fn(),
      normalize: value => value as string,
      merge: latest => latest,
      isConflict: () => false,
    })
    expect(cache.latest).toEqual({ revision: 2, state: 'value' })
  })
})
