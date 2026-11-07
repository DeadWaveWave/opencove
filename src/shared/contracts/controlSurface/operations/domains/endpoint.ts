import * as z from 'zod'
import {
  normalizeEndpointList,
  normalizeEndpointPing,
  normalizeEndpointRegister,
  normalizeEndpointRemove,
} from '../topologyHandlersNormalize'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
export const endpointHomeDirectoryOperation = defineLegacyOperation({
  id: 'endpoint.homeDirectory',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get the home directory and platform of a Worker endpoint',
})
export const endpointListOperation = defineOperation({
  input: z
    .unknown()
    .describe(
      'Legacy endpoint.list wire payload; normalization preserves the existing accept-domain.',
    ),
  normalize: normalizeEndpointList,
  errors: [],
  id: 'endpoint.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List registered Worker endpoints including the local Worker',
})
export const endpointOverviewListOperation = defineLegacyOperation({
  id: 'endpoint.overview.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List endpoint health, mount usage and active SSH operations',
})
export const endpointPingOperation = defineOperation({
  input: z.object({
    endpointId: z.string(),
    timeoutMs: z.unknown().optional(),
  }),
  normalize: normalizeEndpointPing,
  legacyNormalize: normalizeEndpointPing,
  errors: ['worker.unavailable'],
  id: 'endpoint.ping',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Check connectivity to a local or remote Worker endpoint',
})
export const endpointPrepareOperation = defineLegacyOperation({
  id: 'endpoint.prepare',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Install or update the managed runtime on an SSH endpoint',
})
export const endpointReadDirectoryOperation = defineLegacyOperation({
  id: 'endpoint.readDirectory',
  kind: 'query',
  // Approves the remote root before reading, so this query expands permissions.
  scope: 'admin',
  availability: 'always',
  summary: 'Approve a remote directory root and list its entries',
})
export const endpointRegisterOperation = defineOperation({
  input: z.object({
    hostname: z.string(),
    port: z.number(),
    token: z.string(),
    displayName: z.unknown().optional(),
  }),
  normalize: normalizeEndpointRegister,
  legacyNormalize: normalizeEndpointRegister,
  errors: [],
  id: 'endpoint.register',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Register a remote Worker address and authentication token',
})
export const endpointRegisterManagedSshOperation = defineLegacyOperation({
  id: 'endpoint.registerManagedSsh',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Save an SSH endpoint configuration for managed Worker access',
})
export const endpointRemoveOperation = defineOperation({
  input: z.object({
    endpointId: z.string(),
    expectedMountCount: z.number().nullish(),
  }),
  normalize: normalizeEndpointRemove,
  legacyNormalize: normalizeEndpointRemove,
  errors: [],
  id: 'endpoint.remove',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Remove a remote endpoint, its credentials, mounts and SSH runtime',
})
export const endpointRepairOperation = defineLegacyOperation({
  id: 'endpoint.repair',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Start managed SSH repair or retry failed local topology persistence',
})
export const endpointSshConfigHostsOperation = defineLegacyOperation({
  id: 'endpoint.sshConfigHosts',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List concrete host aliases from the local SSH configuration',
})
export const endpointUpdateManagedSshOperation = defineLegacyOperation({
  id: 'endpoint.updateManagedSsh',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Replace SSH settings, stop the old tunnel and start reconnection',
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
