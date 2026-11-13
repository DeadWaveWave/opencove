import * as z from 'zod'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
import { normalizeMaintenanceWire } from '../managedRuntimeNormalize'
import { requireNullPayload } from '../workerConfigurationNormalize'
import {
  normalizeSetConfig,
  normalizeSetSecurity,
  normalizeSetSettings,
} from '../workerMutationNormalize'
export const workerConfigGetOperation = defineOperation({
  input: z.null().describe('Send null to read the Worker configuration'),
  normalize: requireNullPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: requireNullPayload,
  errors: ['worker.unavailable'],
  id: 'worker.config.get',
  kind: 'query',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Read configuration and Web access status (Desktop-managed Worker only)',
})
export const workerConfigSetOperation = defineOperation({
  input: z.object({
    expectedUpdatedAt: z
      .string()
      .nullable()
      .describe('Current configuration revision; null for initial configuration'),
    value: z.object({
      mode: z.enum(['standalone', 'local', 'remote']).describe('Worker execution mode'),
      remote: z
        .unknown()
        .optional()
        .describe(
          'Remote endpoint with hostname, port and token; invalid endpoints normalize to null',
        ),
    }),
  }),
  normalize: normalizeSetConfig,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeSetConfig,
  errors: ['worker.unavailable'],
  id: 'worker.config.set',
  kind: 'command',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Save Worker configuration with a revision check (Desktop-managed Worker only)',
})
export const workerMaintenanceAcquireOperation = defineOperation({
  input: z.union([
    z.object({
      instanceId: z.string().describe('Target managed runtime instance identifier'),
      lease: z
        .string()
        .describe('Lease identifier: 1 to 128 ASCII letters, digits, underscores or hyphens'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeMaintenanceWire,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeMaintenanceWire,
  errors: [],
  id: 'worker.maintenance.acquire',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Acquire an idle managed runtime lease and block new work',
})
export const workerMaintenanceActivateOperation = defineOperation({
  input: z.union([
    z.object({
      instanceId: z.string().describe('Target managed runtime instance identifier'),
      lease: z
        .string()
        .describe('Lease identifier: 1 to 128 ASCII letters, digits, underscores or hyphens'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeMaintenanceWire,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeMaintenanceWire,
  errors: [],
  id: 'worker.maintenance.activate',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Activate a candidate managed runtime using its lease',
})
export const workerMaintenanceReleaseOperation = defineOperation({
  input: z.union([
    z.object({
      instanceId: z.string().describe('Target managed runtime instance identifier'),
      lease: z
        .string()
        .describe('Lease identifier: 1 to 128 ASCII letters, digits, underscores or hyphens'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeMaintenanceWire,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeMaintenanceWire,
  errors: [],
  id: 'worker.maintenance.release',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Release a managed runtime lease and resume accepting work',
})
export const workerMaintenanceStatusOperation = defineLegacyOperation({
  compat: 'control-surface-legacy-validation',
  id: 'worker.maintenance.status',
  kind: 'query',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Read the maintenance phase and activation id of a managed runtime',
})
export const workerMaintenanceStopOperation = defineOperation({
  input: z.union([
    z.object({
      instanceId: z.string().describe('Target managed runtime instance identifier'),
      lease: z
        .string()
        .describe('Lease identifier: 1 to 128 ASCII letters, digits, underscores or hyphens'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeMaintenanceWire,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeMaintenanceWire,
  errors: [],
  id: 'worker.maintenance.stop',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Stop an idle managed runtime using its maintenance or activation lease',
})
export const workerWebAccessSetSecurityOperation = defineOperation({
  input: z.object({
    expectedUpdatedAt: z
      .string()
      .nullable()
      .describe('Current configuration revision; null for initial configuration'),
    value: z.object({
      exposeOnLan: z.boolean().describe('Allow LAN access'),
      password: z.string().nullable().describe('New password; null keeps the current password'),
    }),
  }),
  normalize: normalizeSetSecurity,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeSetSecurity,
  errors: ['worker.unavailable'],
  id: 'worker.webAccess.setSecurity',
  kind: 'command',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Change Web access security and revoke sessions (Desktop-managed Worker only)',
})
export const workerWebAccessSetSettingsOperation = defineOperation({
  input: z.object({
    expectedUpdatedAt: z
      .string()
      .nullable()
      .describe('Current configuration revision; null for initial configuration'),
    value: z.object({
      enabled: z.boolean().describe('Enable Web access'),
      port: z.number().nullish().describe('Listener port; zero or null selects automatically'),
    }),
  }),
  normalize: normalizeSetSettings,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeSetSettings,
  errors: ['worker.unavailable'],
  id: 'worker.webAccess.setSettings',
  kind: 'command',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Apply Web listener settings (Desktop-managed Worker only)',
})
export const workerOperations = [
  workerConfigGetOperation,
  workerConfigSetOperation,
  workerMaintenanceAcquireOperation,
  workerMaintenanceActivateOperation,
  workerMaintenanceReleaseOperation,
  workerMaintenanceStatusOperation,
  workerMaintenanceStopOperation,
  workerWebAccessSetSecurityOperation,
  workerWebAccessSetSettingsOperation,
] as const
