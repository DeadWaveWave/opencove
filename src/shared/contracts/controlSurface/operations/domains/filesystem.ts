import {
  normalizeFilesystemReadDirectory,
  normalizeFilesystemReadFileText,
  normalizeFilesystemStat,
} from '../filesystemHandlersNormalize'
import {
  normalizeFilesystemReadDirectoryInMount,
  normalizeFilesystemReadFileTextInMount,
  normalizeFilesystemStatInMount,
} from '../filesystemMountReadHandlersNormalize'
import { normalizeFilesystemWriteFileTextInMount } from '../filesystemMountWriteHandlersNormalize'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
import * as z from 'zod'
import { normalizeWriteFileTextPayload } from '../filesystemNormalize'
export const filesystemCopyEntryOperation = defineLegacyOperation({
  id: 'filesystem.copyEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Copy a file or directory between URIs within approved roots',
})
export const filesystemCopyEntryInMountOperation = defineLegacyOperation({
  id: 'filesystem.copyEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Copy a file or directory between URIs within one mount root',
})
export const filesystemCreateDirectoryOperation = defineLegacyOperation({
  id: 'filesystem.createDirectory',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a directory at a file URI within approved roots',
})
export const filesystemCreateDirectoryInMountOperation = defineLegacyOperation({
  id: 'filesystem.createDirectoryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a directory within a local or remote mount root',
})
export const filesystemDeleteEntryOperation = defineLegacyOperation({
  id: 'filesystem.deleteEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Delete a file or directory within approved roots',
})
export const filesystemDeleteEntryInMountOperation = defineLegacyOperation({
  id: 'filesystem.deleteEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Delete a file or directory within a local or remote mount root',
})
export const filesystemMoveEntryOperation = defineLegacyOperation({
  id: 'filesystem.moveEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Move a file or directory between URIs within approved roots',
})
export const filesystemMoveEntryInMountOperation = defineLegacyOperation({
  id: 'filesystem.moveEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Move a file or directory between URIs within one mount root',
})
export const filesystemMutationCapabilitiesOperation = defineLegacyOperation({
  id: 'filesystem.mutationCapabilities',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List supported file mutation options and protocol capabilities',
})
export const filesystemReadDirectoryOperation = defineOperation({
  // Legacy isRecord accepts arrays with named uri/limit properties in-process.
  input: z.union([
    z.object({
      uri: z.string(),
      maxEntries: z.number().optional(),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemReadDirectory,
  legacyNormalize: normalizeFilesystemReadDirectory,
  errors: ['filesystem.read_directory_failed'],
  id: 'filesystem.readDirectory',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List directory entries at a file URI within approved roots',
})
export const filesystemReadDirectoryInMountOperation = defineOperation({
  input: z.object({
    uri: z.string(),
    mountId: z.string(),
    maxEntries: z.number().optional(),
  }),
  normalize: normalizeFilesystemReadDirectoryInMount,
  legacyNormalize: normalizeFilesystemReadDirectoryInMount,
  errors: ['worker.unavailable', 'filesystem.read_directory_failed'],
  id: 'filesystem.readDirectoryInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List directory entries within a local or remote mount root',
})
export const filesystemReadFileBytesOperation = defineLegacyOperation({
  id: 'filesystem.readFileBytes',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read binary file contents within approved roots',
})
export const filesystemReadFileBytesInMountOperation = defineLegacyOperation({
  id: 'filesystem.readFileBytesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read binary file contents within a local or remote mount root',
})
export const filesystemReadFileTextOperation = defineOperation({
  // Legacy isRecord accepts arrays with named uri/limit properties in-process.
  input: z.union([
    z.object({
      uri: z.string(),
      maxBytes: z.number().optional(),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemReadFileText,
  legacyNormalize: normalizeFilesystemReadFileText,
  errors: ['filesystem.read_file_text_failed'],
  id: 'filesystem.readFileText',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read text from a file URI within approved roots',
})
export const filesystemReadFileTextInMountOperation = defineOperation({
  input: z.object({
    uri: z.string(),
    mountId: z.string(),
    maxBytes: z.number().optional(),
  }),
  normalize: normalizeFilesystemReadFileTextInMount,
  legacyNormalize: normalizeFilesystemReadFileTextInMount,
  errors: ['worker.unavailable', 'filesystem.read_file_text_failed'],
  id: 'filesystem.readFileTextInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read file text within a local or remote mount root',
})
export const filesystemRenameEntryOperation = defineLegacyOperation({
  id: 'filesystem.renameEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a file or directory within approved roots',
})
export const filesystemRenameEntryInMountOperation = defineLegacyOperation({
  id: 'filesystem.renameEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a file or directory within a local or remote mount root',
})
export const filesystemStatOperation = defineOperation({
  // Legacy isRecord accepts arrays with named uri/limit properties in-process.
  input: z.union([
    z.object({
      uri: z.string(),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemStat,
  legacyNormalize: normalizeFilesystemStat,
  errors: ['filesystem.stat_failed'],
  id: 'filesystem.stat',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get file or directory metadata within approved roots',
})
export const filesystemStatInMountOperation = defineOperation({
  input: z.object({
    uri: z.string(),
    mountId: z.string(),
  }),
  normalize: normalizeFilesystemStatInMount,
  legacyNormalize: normalizeFilesystemStatInMount,
  errors: ['worker.unavailable', 'filesystem.stat_failed'],
  id: 'filesystem.statInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get file or directory metadata within a local or remote mount root',
})
export const filesystemWriteFileTextOperation = defineOperation({
  id: 'filesystem.writeFileText',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Write text to a file URI',
  input: z
    .unknown()
    .describe(
      'Legacy file write payload: uri string, content string, optional overwrite boolean; normalized separately to preserve named array properties for in-process callers.',
    ),
  normalize: normalizeWriteFileTextPayload,
  errors: ['filesystem.write_file_text_failed'],
})
export const filesystemWriteFileTextInMountOperation = defineOperation({
  input: z.object({
    uri: z.string(),
    mountId: z.string(),
    content: z.string(),
    overwrite: z.boolean().optional(),
  }),
  normalize: normalizeFilesystemWriteFileTextInMount,
  legacyNormalize: normalizeFilesystemWriteFileTextInMount,
  errors: ['worker.unavailable', 'filesystem.write_file_text_failed'],
  id: 'filesystem.writeFileTextInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Write file text within a local or remote mount root',
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
