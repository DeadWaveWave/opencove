import { normalizeFilesystemReadFileBytes } from '../filesystemEntryHandlersNormalize'
import { normalizeFilesystemCreateDirectory } from '../filesystemEntryHandlersNormalize'
import { normalizeFilesystemCopyEntry } from '../filesystemEntryHandlersNormalize'
import { normalizeFilesystemMoveEntry } from '../filesystemEntryHandlersNormalize'
import { normalizeFilesystemRenameEntry } from '../filesystemEntryHandlersNormalize'
import { normalizeFilesystemDeleteEntry } from '../filesystemEntryHandlersNormalize'
import { normalizeFilesystemReadFileBytesInMount } from '../filesystemMountByteReadHandlersNormalize'
import { normalizeFilesystemCreateDirectoryInMount } from '../filesystemMountEntryHandlersNormalize'
import { normalizeFilesystemDeleteEntryInMount } from '../filesystemMountEntryHandlersNormalize'
import { normalizeFilesystemCopyEntryInMount } from '../filesystemMountEntryHandlersNormalize'
import { normalizeFilesystemMoveEntryInMount } from '../filesystemMountEntryHandlersNormalize'
import { normalizeFilesystemRenameEntryInMount } from '../filesystemMountEntryHandlersNormalize'
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
export const filesystemCopyEntryOperation = defineOperation({
  input: z.union([
    z.object({
      sourceUri: z.string().describe('Source file URI within approved roots'),
      targetUri: z.string().describe('Destination file URI within approved roots'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemCopyEntry,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemCopyEntry,
  errors: ['filesystem.copy_entry_failed'],
  id: 'filesystem.copyEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Copy a file or directory between URIs within approved roots',
})
export const filesystemCopyEntryInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    sourceUri: z.string().describe('Source file URI within approved roots'),
    targetUri: z.string().describe('Destination file URI within approved roots'),
  }),
  normalize: normalizeFilesystemCopyEntryInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemCopyEntryInMount,
  errors: ['filesystem.copy_entry_failed', 'worker.unavailable'],
  id: 'filesystem.copyEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Copy a file or directory between URIs within one mount root',
})
export const filesystemCreateDirectoryOperation = defineOperation({
  input: z.union([
    z.object({ uri: z.string().describe('File URI within approved roots') }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemCreateDirectory,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemCreateDirectory,
  errors: ['filesystem.create_directory_failed'],
  id: 'filesystem.createDirectory',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a directory at a file URI within approved roots',
})
export const filesystemCreateDirectoryInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    uri: z.string().describe('File URI within approved roots'),
  }),
  normalize: normalizeFilesystemCreateDirectoryInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemCreateDirectoryInMount,
  errors: ['filesystem.create_directory_failed', 'worker.unavailable'],
  id: 'filesystem.createDirectoryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a directory within a local or remote mount root',
})
export const filesystemDeleteEntryOperation = defineOperation({
  input: z.union([
    z.object({
      uri: z.string().describe('File URI within approved roots'),
      // @compat control-surface-legacy-validation
      recursive: z
        .boolean()
        .optional()
        .describe(
          'Whether to delete directories recursively; omit to retain legacy deletion behavior',
        ),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemDeleteEntry,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemDeleteEntry,
  errors: ['filesystem.delete_entry_failed'],
  id: 'filesystem.deleteEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Delete a file or directory within approved roots',
})
export const filesystemDeleteEntryInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    uri: z.string().describe('File URI within approved roots'),
    // @compat control-surface-legacy-validation
    recursive: z
      .boolean()
      .optional()
      .describe(
        'Whether to delete directories recursively; omit to retain legacy deletion behavior',
      ),
  }),
  normalize: normalizeFilesystemDeleteEntryInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemDeleteEntryInMount,
  errors: ['filesystem.delete_entry_failed', 'worker.unavailable'],
  id: 'filesystem.deleteEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Delete a file or directory within a local or remote mount root',
})
export const filesystemMoveEntryOperation = defineOperation({
  input: z.union([
    z.object({
      sourceUri: z.string().describe('Source file URI within approved roots'),
      targetUri: z.string().describe('Destination file URI within approved roots'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemMoveEntry,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemMoveEntry,
  errors: ['filesystem.move_entry_failed'],
  id: 'filesystem.moveEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Move a file or directory between URIs within approved roots',
})
export const filesystemMoveEntryInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    sourceUri: z.string().describe('Source file URI within approved roots'),
    targetUri: z.string().describe('Destination file URI within approved roots'),
  }),
  normalize: normalizeFilesystemMoveEntryInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemMoveEntryInMount,
  errors: ['filesystem.move_entry_failed', 'worker.unavailable'],
  id: 'filesystem.moveEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Move a file or directory between URIs within one mount root',
})
export const filesystemMutationCapabilitiesOperation = defineLegacyOperation({
  compat: 'control-surface-legacy-validation',
  id: 'filesystem.mutationCapabilities',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List supported file mutation options and protocol capabilities',
})
export const filesystemReadDirectoryOperation = defineOperation({
  // @compat control-surface-legacy-validation
  // Legacy isRecord accepts arrays with named uri/limit properties in-process.
  input: z.union([
    z.object({
      uri: z.string(),
      maxEntries: z.number().optional(),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemReadDirectory,
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemReadDirectoryInMount,
  errors: ['worker.unavailable', 'filesystem.read_directory_failed'],
  id: 'filesystem.readDirectoryInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List directory entries within a local or remote mount root',
})
export const filesystemReadFileBytesOperation = defineOperation({
  input: z.union([
    z.object({ uri: z.string().describe('File URI within approved roots') }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemReadFileBytes,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemReadFileBytes,
  errors: ['filesystem.read_file_bytes_failed'],
  id: 'filesystem.readFileBytes',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read binary file contents within approved roots',
})
export const filesystemReadFileBytesInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    uri: z.string().describe('File URI within approved roots'),
  }),
  normalize: normalizeFilesystemReadFileBytesInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemReadFileBytesInMount,
  errors: ['filesystem.read_file_bytes_failed', 'worker.unavailable'],
  id: 'filesystem.readFileBytesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read binary file contents within a local or remote mount root',
})
export const filesystemReadFileTextOperation = defineOperation({
  // @compat control-surface-legacy-validation
  // Legacy isRecord accepts arrays with named uri/limit properties in-process.
  input: z.union([
    z.object({
      uri: z.string(),
      maxBytes: z.number().optional(),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemReadFileText,
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemReadFileTextInMount,
  errors: ['worker.unavailable', 'filesystem.read_file_text_failed'],
  id: 'filesystem.readFileTextInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read file text within a local or remote mount root',
})
export const filesystemRenameEntryOperation = defineOperation({
  input: z.union([
    z.object({
      sourceUri: z.string().describe('Source file URI within approved roots'),
      targetUri: z.string().describe('Destination file URI within approved roots'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemRenameEntry,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemRenameEntry,
  errors: ['filesystem.rename_entry_failed'],
  id: 'filesystem.renameEntry',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a file or directory within approved roots',
})
export const filesystemRenameEntryInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    sourceUri: z.string().describe('Source file URI within approved roots'),
    targetUri: z.string().describe('Destination file URI within approved roots'),
  }),
  normalize: normalizeFilesystemRenameEntryInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeFilesystemRenameEntryInMount,
  errors: ['filesystem.rename_entry_failed', 'worker.unavailable'],
  id: 'filesystem.renameEntryInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a file or directory within a local or remote mount root',
})
export const filesystemStatOperation = defineOperation({
  // @compat control-surface-legacy-validation
  // Legacy isRecord accepts arrays with named uri/limit properties in-process.
  input: z.union([
    z.object({
      uri: z.string(),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeFilesystemStat,
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
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
  // @compat control-surface-legacy-validation
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
  compat: 'control-surface-legacy-validation',
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
