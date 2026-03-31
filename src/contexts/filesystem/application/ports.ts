import type {
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemStat,
  MoveEntryInput,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  RenameEntryInput,
  StatInput,
  WriteFileTextInput,
} from '@shared/contracts/dto'

export type {
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemStat,
  MoveEntryInput,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  RenameEntryInput,
  StatInput,
  WriteFileTextInput,
}

export interface FileSystemPort {
  copyEntry: (input: CopyEntryInput) => Promise<void>
  createDirectory: (input: CreateDirectoryInput) => Promise<void>
  deleteEntry: (input: DeleteEntryInput) => Promise<void>
  moveEntry: (input: MoveEntryInput) => Promise<void>
  readFileBytes: (input: ReadFileBytesInput) => Promise<ReadFileBytesResult>
  readFileText: (input: ReadFileTextInput) => Promise<ReadFileTextResult>
  renameEntry: (input: RenameEntryInput) => Promise<void>
  writeFileText: (input: WriteFileTextInput) => Promise<void>
  stat: (input: StatInput) => Promise<FileSystemStat>
  readDirectory: (input: ReadDirectoryInput) => Promise<ReadDirectoryResult>
}
