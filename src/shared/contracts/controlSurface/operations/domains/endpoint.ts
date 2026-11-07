import { defineLegacyOperation } from '../defineOperation'
export const endpointHomeDirectoryOperation = defineLegacyOperation({
  id: 'endpoint.homeDirectory',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform endpoint home Directory.',
})
export const endpointListOperation = defineLegacyOperation({
  id: 'endpoint.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query endpoint list.',
})
export const endpointOverviewListOperation = defineLegacyOperation({
  id: 'endpoint.overview.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query endpoint overview list.',
})
export const endpointPingOperation = defineLegacyOperation({
  id: 'endpoint.ping',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform endpoint ping.',
})
export const endpointPrepareOperation = defineLegacyOperation({
  id: 'endpoint.prepare',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform endpoint prepare.',
})
export const endpointReadDirectoryOperation = defineLegacyOperation({
  id: 'endpoint.readDirectory',
  kind: 'query',
  // Approves the remote root before reading, so this query expands permissions.
  scope: 'admin',
  availability: 'always',
  summary: 'Perform endpoint read Directory.',
})
export const endpointRegisterOperation = defineLegacyOperation({
  id: 'endpoint.register',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform endpoint register.',
})
export const endpointRegisterManagedSshOperation = defineLegacyOperation({
  id: 'endpoint.registerManagedSsh',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform endpoint register Managed Ssh.',
})
export const endpointRemoveOperation = defineLegacyOperation({
  id: 'endpoint.remove',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform endpoint remove.',
})
export const endpointRepairOperation = defineLegacyOperation({
  id: 'endpoint.repair',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform endpoint repair.',
})
export const endpointSshConfigHostsOperation = defineLegacyOperation({
  id: 'endpoint.sshConfigHosts',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform endpoint ssh Config Hosts.',
})
export const endpointUpdateManagedSshOperation = defineLegacyOperation({
  id: 'endpoint.updateManagedSsh',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform endpoint update Managed Ssh.',
})
export const endpointOperations = [
  endpointHomeDirectoryOperation,
  endpointListOperation,
  endpointOverviewListOperation,
  endpointPingOperation,
  endpointPrepareOperation,
  endpointReadDirectoryOperation,
  endpointRegisterOperation,
  endpointRegisterManagedSshOperation,
  endpointRemoveOperation,
  endpointRepairOperation,
  endpointSshConfigHostsOperation,
  endpointUpdateManagedSshOperation,
] as const
