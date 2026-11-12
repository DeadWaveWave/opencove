import { normalizePtySpawnPayload } from '../sessionStreamingNormalize'
import * as z from 'zod'
import { normalizePtySpawnInMount } from '../ptyMountHandlersNormalize'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
export const ptyDebugCrashHostOperation = defineLegacyOperation({
  id: 'pty.debugCrashHost',
  kind: 'command',
  scope: 'admin',
  availability: 'debug',
  summary: 'Crash the PTY host and terminate its sessions (debug only)',
})
export const ptyListProfilesOperation = defineLegacyOperation({
  id: 'pty.listProfiles',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List available terminal profiles and the default profile id',
})
export const ptySpawnOperation = defineOperation({
  input: z.looseObject({
    cwd: z.string().describe('Approved absolute working directory'),
    workspaceId: z.string().optional().describe('Project that owns the terminal'),
    profileId: z
      .unknown()
      .optional()
      .describe('Terminal profile id; blank or non-string values use the default profile'),
    shell: z
      .unknown()
      .optional()
      .describe('Shell executable; blank or non-string values use the configured shell'),
    command: z
      .unknown()
      .optional()
      .describe('Command to launch; blank or non-string values use the default shell'),
    args: z
      .unknown()
      .optional()
      .describe('Command argument strings; non-string arrays and non-arrays are ignored'),
    env: z
      .unknown()
      .optional()
      .describe(
        'Environment overrides; shared environment normalizer filters invalid keys and values',
      ),
    cols: z
      .unknown()
      .optional()
      .describe('Positive column count, rounded down; invalid values use the operation default'),
    rows: z
      .unknown()
      .optional()
      .describe('Positive row count, rounded down; invalid values use the operation default'),
  }),
  normalize: normalizePtySpawnPayload,
  legacyNormalize: normalizePtySpawnPayload,
  errors: ['terminal.spawn_failed', 'terminal.runtime_not_ready'],
  id: 'pty.spawn',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Start a shell or command in a terminal under an approved directory',
})
export const ptySpawnInMountOperation = defineOperation({
  input: z.object({
    mountId: z.string(),
    cwdUri: z.string().nullish(),
    profileId: z.unknown().optional(),
    shell: z.unknown().optional(),
    command: z.unknown().optional(),
    args: z.unknown().optional(),
    cols: z.unknown().optional(),
    rows: z.unknown().optional(),
    env: z.unknown().optional(),
  }),
  normalize: normalizePtySpawnInMount,
  legacyNormalize: normalizePtySpawnInMount,
  errors: ['worker.unavailable', 'terminal.spawn_failed', 'terminal.runtime_not_ready'],
  id: 'pty.spawnInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Start a shell or command within a local or remote mount root',
})
export const ptyOperations = [
  ptyDebugCrashHostOperation,
  ptyListProfilesOperation,
  ptySpawnOperation,
  ptySpawnInMountOperation,
] as const
