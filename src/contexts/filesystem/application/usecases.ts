import { fileSystemOperation } from './fileSystemOperation'
import type {
  FileSystemPort,
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  MoveEntryInput,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  RenameEntryInput,
  StatInput,
  FileSystemStat,
  WriteFileTextInput,
} from './ports'

export async function copyEntryUseCase(port: FileSystemPort, input: CopyEntryInput): Promise<void> {
  await fileSystemOperation('filesystem.copy_entry_failed', () => port.copyEntry(input))
}

export async function createDirectoryUseCase(
  port: FileSystemPort,
  input: CreateDirectoryInput,
): Promise<void> {
  await fileSystemOperation('filesystem.create_directory_failed', () => port.createDirectory(input))
}

export async function deleteEntryUseCase(
  port: FileSystemPort,
  input: DeleteEntryInput,
): Promise<void> {
  await fileSystemOperation('filesystem.delete_entry_failed', () => port.deleteEntry(input))
}

export async function moveEntryUseCase(port: FileSystemPort, input: MoveEntryInput): Promise<void> {
  await fileSystemOperation('filesystem.move_entry_failed', () => port.moveEntry(input))
}

export async function readFileBytesUseCase(
  port: FileSystemPort,
  input: ReadFileBytesInput,
): Promise<ReadFileBytesResult> {
  return await fileSystemOperation('filesystem.read_file_bytes_failed', () =>
    port.readFileBytes(input),
  )
}

export async function readFileTextUseCase(
  port: FileSystemPort,
  input: ReadFileTextInput,
): Promise<ReadFileTextResult> {
  return await fileSystemOperation('filesystem.read_file_text_failed', () =>
    port.readFileText(input),
  )
}

export async function renameEntryUseCase(
  port: FileSystemPort,
  input: RenameEntryInput,
): Promise<void> {
  await fileSystemOperation('filesystem.rename_entry_failed', () => port.renameEntry(input))
}

export async function writeFileTextUseCase(
  port: FileSystemPort,
  input: WriteFileTextInput,
): Promise<void> {
  await fileSystemOperation('filesystem.write_file_text_failed', () => port.writeFileText(input))
}

export async function statUseCase(port: FileSystemPort, input: StatInput): Promise<FileSystemStat> {
  return await fileSystemOperation('filesystem.stat_failed', () => port.stat(input))
}

export async function readDirectoryUseCase(
  port: FileSystemPort,
  input: ReadDirectoryInput,
): Promise<ReadDirectoryResult> {
  return await fileSystemOperation('filesystem.read_directory_failed', () =>
    port.readDirectory(input),
  )
}
