import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { toFileUri } from '../../../src/contexts/filesystem/domain/fileUri'
import { deleteEntryWithTrashFallback } from '../../../src/contexts/filesystem/application/deleteEntryWithTrashFallback'
import type { FileSystemPort } from '../../../src/contexts/filesystem/application/ports'

function createFileSystemPortMock(): FileSystemPort {
  return {
    copyEntry: vi.fn(async () => undefined),
    createDirectory: vi.fn(async () => undefined),
    deleteEntry: vi.fn(async () => undefined),
    moveEntry: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => ({ entries: [] })),
    readFileBytes: vi.fn(async () => ({ data: new Uint8Array() })),
    readFileText: vi.fn(async () => ({ content: '' })),
    renameEntry: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ kind: 'file', size: 0, modifiedAt: null })),
    writeFileText: vi.fn(async () => undefined),
  }
}

describe('deleteEntryWithTrashFallback', () => {
  it('falls back to direct delete when trashing never settles', async () => {
    vi.useFakeTimers()

    try {
      const port = createFileSystemPortMock()
      const targetPath = join(tmpdir(), 'opencove-delete-timeout.txt')
      const input = { uri: toFileUri(targetPath) }
      const trashItem = vi.fn(() => new Promise<void>(() => undefined))

      const deletePromise = deleteEntryWithTrashFallback({
        port,
        input,
        trashItem,
        trashTimeoutMs: 25,
      })

      await vi.advanceTimersByTimeAsync(25)
      await deletePromise

      expect(trashItem).toHaveBeenCalledWith(targetPath)
      expect(port.deleteEntry).toHaveBeenCalledWith(input)
    } finally {
      vi.useRealTimers()
    }
  })
})
