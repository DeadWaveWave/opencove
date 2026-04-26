import { fileURLToPath } from 'node:url'
import type { DeleteEntryInput, FileSystemPort } from './ports'
import { deleteEntryUseCase } from './usecases'

const DEFAULT_TRASH_TIMEOUT_MS = 3_000

export async function trashItemWithTimeout(
  trashItem: (targetPath: string) => Promise<void>,
  targetPath: string,
  timeoutMs: number,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    await Promise.race([
      trashItem(targetPath),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Timed out while moving entry to trash'))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }
}

export async function deleteEntryWithTrashFallback({
  port,
  input,
  trashItem,
  trashTimeoutMs = DEFAULT_TRASH_TIMEOUT_MS,
}: {
  port: FileSystemPort
  input: DeleteEntryInput
  trashItem: (targetPath: string) => Promise<void>
  trashTimeoutMs?: number
}): Promise<void> {
  const targetPath = fileURLToPath(input.uri)

  try {
    await trashItemWithTimeout(trashItem, targetPath, trashTimeoutMs)
  } catch {
    await deleteEntryUseCase(port, input)
  }
}
