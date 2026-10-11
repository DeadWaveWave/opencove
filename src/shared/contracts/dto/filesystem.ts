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
  maxBytes?: number
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

export interface ReadFileBytesInMountInput extends MountAwareInput {
  uri: string
}

export interface WriteFileTextInput {
  overwrite?: boolean
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
  recursive?: boolean
  uri: string
}

export interface CreateDirectoryInput {
  uri: string
}

export interface ReadDirectoryInput {
  maxEntries?: number
  uri: string
}

export interface ReadDirectoryResult {
  truncated?: boolean
  entries: FileSystemEntry[]
}

export interface StatInput {
  uri: string
}

export interface MountAwareInput {
  mountId: string
}

export interface ReadFileTextInMountInput extends MountAwareInput {
  maxBytes?: number
  uri: string
}

export interface ReadFileBytesInMountInput extends MountAwareInput {
  uri: string
}

export interface WriteFileTextInMountInput extends MountAwareInput {
  overwrite?: boolean
  uri: string
  content: string
}

export interface StatInMountInput extends MountAwareInput {
  uri: string
}

export interface ReadDirectoryInMountInput extends MountAwareInput {
  maxEntries?: number
  uri: string
}

export interface CreateDirectoryInMountInput extends MountAwareInput {
  uri: string
}

export interface DeleteEntryInMountInput extends MountAwareInput {
  recursive?: boolean
  uri: string
}

export interface CopyEntryInMountInput extends MountAwareInput {
  sourceUri: string
  targetUri: string
}

export interface MoveEntryInMountInput extends MountAwareInput {
  sourceUri: string
  targetUri: string
}

export interface RenameEntryInMountInput extends MountAwareInput {
  sourceUri: string
  targetUri: string
}
