import { fileURLToPath } from 'node:url'
import type { DeleteEntryInput, FileSystemPort } from './ports'
import { deleteEntryUseCase } from './usecases'

export async function deleteEntryWithTrashFallback({
  port,
  input,
  trashItem,
}: {
  port: FileSystemPort
  input: DeleteEntryInput
  trashItem: (targetPath: string) => Promise<void>
}): Promise<void> {
  const targetPath = fileURLToPath(input.uri)

  try {
    await trashItem(targetPath)
  } catch {
    await deleteEntryUseCase(port, input)
  }
}
