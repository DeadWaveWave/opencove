import { defineLegacyOperation } from '../defineOperation'
export const ptyDebugCrashHostOperation = defineLegacyOperation({
  id: 'pty.debugCrashHost',
  kind: 'command',
  scope: 'admin',
  availability: 'debug',
  summary: 'Perform pty debug Crash Host.',
})
export const ptyListProfilesOperation = defineLegacyOperation({
  id: 'pty.listProfiles',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query pty list Profiles.',
})
export const ptySpawnOperation = defineLegacyOperation({
  id: 'pty.spawn',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform pty spawn.',
})
export const ptySpawnInMountOperation = defineLegacyOperation({
  id: 'pty.spawnInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform pty spawn In Mount.',
})
export const ptyOperations = [
  ptyDebugCrashHostOperation,
  ptyListProfilesOperation,
  ptySpawnOperation,
  ptySpawnInMountOperation,
] as const
