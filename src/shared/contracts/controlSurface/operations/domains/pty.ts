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
export const ptySpawnOperation = defineLegacyOperation({
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
