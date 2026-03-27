import type {
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemStat,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInput,
  WriteFileTextInput,
} from '@shared/contracts/dto'

export type {
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemStat,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInput,
  WriteFileTextInput,
}

export interface FileSystemPort {
  readFileText: (input: ReadFileTextInput) => Promise<ReadFileTextResult>
  writeFileText: (input: WriteFileTextInput) => Promise<void>
  stat: (input: StatInput) => Promise<FileSystemStat>
  readDirectory: (input: ReadDirectoryInput) => Promise<ReadDirectoryResult>
}
