export type FileSystemEntryKind = 'file' | 'directory' | 'unknown'

export interface FileSystemEntry {
  name: string
  uri: string
  kind: FileSystemEntryKind
}

export interface FileSystemStat {
  uri: string
  kind: FileSystemEntryKind
  sizeBytes: number | null
  mtimeMs: number | null
}

export interface ReadFileTextInput {
  uri: string
}

export interface ReadFileTextResult {
  content: string
}

export interface WriteFileTextInput {
  uri: string
  content: string
}

export interface ReadDirectoryInput {
  uri: string
}

export interface ReadDirectoryResult {
  entries: FileSystemEntry[]
}

export interface StatInput {
  uri: string
}

export interface FileSystemPort {
  readFileText: (input: ReadFileTextInput) => Promise<ReadFileTextResult>
  writeFileText: (input: WriteFileTextInput) => Promise<void>
  stat: (input: StatInput) => Promise<FileSystemStat>
  readDirectory: (input: ReadDirectoryInput) => Promise<ReadDirectoryResult>
}
