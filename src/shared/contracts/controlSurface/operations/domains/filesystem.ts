import { defineLegacyOperation, defineOperation } from '../defineOperation'
import * as z from 'zod'
export const filesystemCopyEntryOperation = defineLegacyOperation({
  id: 'filesystem.copyEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem copy Entry.',
})
export const filesystemCopyEntryInMountOperation = defineLegacyOperation({
  id: 'filesystem.copyEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem copy Entry In Mount.',
})
export const filesystemCreateDirectoryOperation = defineLegacyOperation({
  id: 'filesystem.createDirectory',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem create Directory.',
})
export const filesystemCreateDirectoryInMountOperation = defineLegacyOperation({
  id: 'filesystem.createDirectoryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem create Directory In Mount.',
})
export const filesystemDeleteEntryOperation = defineLegacyOperation({
  id: 'filesystem.deleteEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem delete Entry.',
})
export const filesystemDeleteEntryInMountOperation = defineLegacyOperation({
  id: 'filesystem.deleteEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem delete Entry In Mount.',
})
export const filesystemMoveEntryOperation = defineLegacyOperation({
  id: 'filesystem.moveEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem move Entry.',
})
export const filesystemMoveEntryInMountOperation = defineLegacyOperation({
  id: 'filesystem.moveEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem move Entry In Mount.',
})
export const filesystemMutationCapabilitiesOperation = defineLegacyOperation({
  id: 'filesystem.mutationCapabilities',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem mutation Capabilities.',
})
export const filesystemReadDirectoryOperation = defineLegacyOperation({
  id: 'filesystem.readDirectory',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem read Directory.',
})
export const filesystemReadDirectoryInMountOperation = defineLegacyOperation({
  id: 'filesystem.readDirectoryInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem read Directory In Mount.',
})
export const filesystemReadFileBytesOperation = defineLegacyOperation({
  id: 'filesystem.readFileBytes',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem read File Bytes.',
})
export const filesystemReadFileBytesInMountOperation = defineLegacyOperation({
  id: 'filesystem.readFileBytesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem read File Bytes In Mount.',
})
export const filesystemReadFileTextOperation = defineLegacyOperation({
  id: 'filesystem.readFileText',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem read File Text.',
})
export const filesystemReadFileTextInMountOperation = defineLegacyOperation({
  id: 'filesystem.readFileTextInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem read File Text In Mount.',
})
export const filesystemRenameEntryOperation = defineLegacyOperation({
  id: 'filesystem.renameEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem rename Entry.',
})
export const filesystemRenameEntryInMountOperation = defineLegacyOperation({
  id: 'filesystem.renameEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem rename Entry In Mount.',
})
export const filesystemStatOperation = defineLegacyOperation({
  id: 'filesystem.stat',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem stat.',
})
export const filesystemStatInMountOperation = defineLegacyOperation({
  id: 'filesystem.statInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform filesystem stat In Mount.',
})
import { normalizeWriteFileTextPayload } from '../filesystemNormalize'
export const filesystemWriteFileTextOperation = defineOperation({
  id: 'filesystem.writeFileText',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Write text to a file URI.',
  input: z
    .unknown()
    .describe(
      'Legacy file write payload: uri string, content string, optional overwrite boolean; normalized separately to preserve named array properties for in-process callers.',
    ),
  normalize: normalizeWriteFileTextPayload,
  errors: ['filesystem.write_file_text_failed'],
})
export const filesystemWriteFileTextInMountOperation = defineLegacyOperation({
  id: 'filesystem.writeFileTextInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform filesystem write File Text In Mount.',
})
export const filesystemOperations = [
  filesystemCopyEntryOperation,
  filesystemCopyEntryInMountOperation,
  filesystemCreateDirectoryOperation,
  filesystemCreateDirectoryInMountOperation,
  filesystemDeleteEntryOperation,
  filesystemDeleteEntryInMountOperation,
  filesystemMoveEntryOperation,
  filesystemMoveEntryInMountOperation,
  filesystemMutationCapabilitiesOperation,
  filesystemReadDirectoryOperation,
  filesystemReadDirectoryInMountOperation,
  filesystemReadFileBytesOperation,
  filesystemReadFileBytesInMountOperation,
  filesystemReadFileTextOperation,
  filesystemReadFileTextInMountOperation,
  filesystemRenameEntryOperation,
  filesystemRenameEntryInMountOperation,
  filesystemStatOperation,
  filesystemStatInMountOperation,
  filesystemWriteFileTextOperation,
  filesystemWriteFileTextInMountOperation,
] as const
