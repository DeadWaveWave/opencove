import type {
  CreateDirectoryInput,
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemStat,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInput,
  WriteFileTextInput,
} from '@shared/contracts/dto'

export type {
  CreateDirectoryInput,
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemStat,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInput,
  WriteFileTextInput,
}

export interface FileSystemPort {
  createDirectory: (input: CreateDirectoryInput) => Promise<void>
  readFileBytes: (input: ReadFileBytesInput) => Promise<ReadFileBytesResult>
  readFileText: (input: ReadFileTextInput) => Promise<ReadFileTextResult>
  writeFileText: (input: WriteFileTextInput) => Promise<void>
  stat: (input: StatInput) => Promise<FileSystemStat>
  readDirectory: (input: ReadDirectoryInput) => Promise<ReadDirectoryResult>
}
