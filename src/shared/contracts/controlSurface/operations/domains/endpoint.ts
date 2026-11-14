import * as z from 'zod'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
import {
  normalizePrepareEndpointPayload,
  normalizeRegisterManagedSshEndpointPayload,
  normalizeRepairEndpointPayload,
  normalizeUpdateManagedSshEndpointPayload,
} from '../managedSshNormalize'
import {
  normalizeEndpointHomeDirectoryPayload,
  normalizeEndpointReadDirectoryPayload,
  normalizeSshConfigHostsPayload,
} from '../topologyBrowseNormalize'
import {
  normalizeEndpointList,
  normalizeEndpointPing,
  normalizeEndpointRegister,
  normalizeEndpointRemove,
} from '../topologyHandlersNormalize'
export const endpointHomeDirectoryOperation = defineOperation({
  input: z.object({
    endpointId: z.string().describe('Endpoint identifier; use local for this Worker'),
  }),
  normalize: normalizeEndpointHomeDirectoryPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeEndpointHomeDirectoryPayload,
  errors: ['worker.unavailable'],
  id: 'endpoint.homeDirectory',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get the home directory and platform of a Worker endpoint',
})
export const endpointListOperation = defineOperation({
  // @compat control-surface-legacy-validation
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
  compat: 'control-surface-legacy-validation',
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeEndpointPing,
  errors: ['worker.unavailable'],
  id: 'endpoint.ping',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Check connectivity to a local or remote Worker endpoint',
})
export const endpointPrepareOperation = defineOperation({
  input: z.object({
    endpointId: z.string().describe('Endpoint identifier'),
    runtimeBuild: z
      .unknown()
      .optional()
      .describe(
        'Runtime build descriptor validated by parseRuntimeBuildIdentity; falsy values omit the target build',
      ),
    reason: z
      .unknown()
      .optional()
      .describe('Use connect, browse or reconnect; other values are ignored'),
  }),
  normalize: normalizePrepareEndpointPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizePrepareEndpointPayload,
  errors: ['endpoint.operation_in_progress', 'worker.unavailable'],
  id: 'endpoint.prepare',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Install or update the managed runtime on an SSH endpoint',
})
export const endpointReadDirectoryOperation = defineOperation({
  input: z.object({
    endpointId: z.string().describe('Remote endpoint identifier'),
    path: z.string().describe('Absolute directory path on the remote Worker'),
  }),
  normalize: normalizeEndpointReadDirectoryPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeEndpointReadDirectoryPayload,
  errors: ['worker.unavailable', 'filesystem.read_directory_failed'],
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeEndpointRegister,
  errors: [],
  id: 'endpoint.register',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Register a remote Worker address and authentication token',
})
export const endpointRegisterManagedSshOperation = defineOperation({
  input: z.object({
    displayName: z.unknown().optional().describe('Display name string; other values are ignored'),
    host: z.string().describe('SSH hostname or configured Host alias'),
    port: z.number().nullish().describe('SSH port; omit to use SSH configuration'),
    username: z.unknown().optional().describe('SSH username string; other values are ignored'),
    remotePort: z.number().nullish().describe('Remote Worker port'),
    remotePlatform: z
      .unknown()
      .optional()
      .describe('Use posix or windows; any other value selects auto'),
  }),
  normalize: normalizeRegisterManagedSshEndpointPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeRegisterManagedSshEndpointPayload,
  errors: [],
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeEndpointRemove,
  errors: [],
  id: 'endpoint.remove',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Remove a remote endpoint, its credentials, mounts and SSH runtime',
})
export const endpointRepairOperation = defineOperation({
  input: z.object({
    endpointId: z.string().describe('Endpoint identifier'),
    runtimeBuild: z
      .unknown()
      .optional()
      .describe(
        'Runtime build descriptor validated by parseRuntimeBuildIdentity; falsy values omit the target build',
      ),
    action: z
      .enum(['repair_credentials', 'repair_tunnel', 'install_runtime', 'update_runtime', 'retry'])
      .describe('Repair action to perform'),
  }),
  normalize: normalizeRepairEndpointPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeRepairEndpointPayload,
  errors: ['endpoint.operation_in_progress', 'worker.unavailable'],
  id: 'endpoint.repair',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Start managed SSH repair or retry failed local topology persistence',
})
export const endpointSshConfigHostsOperation = defineOperation({
  input: z.null().optional().describe('Send null to list SSH host aliases'),
  normalize: normalizeSshConfigHostsPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeSshConfigHostsPayload,
  errors: [],
  id: 'endpoint.sshConfigHosts',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List concrete host aliases from the local SSH configuration',
})
export const endpointUpdateManagedSshOperation = defineOperation({
  input: z.object({
    endpointId: z.string().describe('Managed endpoint identifier'),
    displayName: z.unknown().optional().describe('Display name string; other values are ignored'),
    host: z.string().describe('SSH hostname or configured Host alias'),
    port: z.number().nullish().describe('SSH port; omit to use SSH configuration'),
    username: z.unknown().optional().describe('SSH username string; other values are ignored'),
    remotePort: z.number().nullish().describe('Remote Worker port'),
    remotePlatform: z
      .unknown()
      .optional()
      .describe('Use posix or windows; any other value selects auto'),
  }),
  normalize: normalizeUpdateManagedSshEndpointPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeUpdateManagedSshEndpointPayload,
  errors: ['endpoint.operation_in_progress'],
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
