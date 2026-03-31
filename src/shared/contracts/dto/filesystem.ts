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

export interface ReadFileBytesInput {
  uri: string
}

export interface ReadFileBytesResult {
  bytes: Uint8Array
}

export interface WriteFileTextInput {
  uri: string
  content: string
}

export interface CopyEntryInput {
  sourceUri: string
  targetUri: string
}

export interface MoveEntryInput {
  sourceUri: string
  targetUri: string
}

export interface RenameEntryInput {
  sourceUri: string
  targetUri: string
}

export interface DeleteEntryInput {
  uri: string
}

export interface CreateDirectoryInput {
  uri: string
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
