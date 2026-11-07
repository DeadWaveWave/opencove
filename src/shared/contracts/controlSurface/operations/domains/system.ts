import { defineLegacyOperation } from '../defineOperation'
export const systemCapabilitiesOperation = defineLegacyOperation({
  id: 'system.capabilities',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform system capabilities.',
})
export const systemHomeDirectoryOperation = defineLegacyOperation({
  id: 'system.homeDirectory',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform system home Directory.',
})
export const systemPingOperation = defineLegacyOperation({
  id: 'system.ping',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform system ping.',
})
export const systemOperations = [
  systemCapabilitiesOperation,
  systemHomeDirectoryOperation,
  systemPingOperation,
] as const
