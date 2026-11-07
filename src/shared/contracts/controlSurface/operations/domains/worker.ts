import { defineLegacyOperation } from '../defineOperation'
export const workerConfigGetOperation = defineLegacyOperation({
  id: 'worker.config.get',
  kind: 'query',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Read configuration and Web access status (Desktop-managed Worker only)',
})
export const workerConfigSetOperation = defineLegacyOperation({
  id: 'worker.config.set',
  kind: 'command',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Save Worker configuration with a revision check (Desktop-managed Worker only)',
})
export const workerMaintenanceAcquireOperation = defineLegacyOperation({
  id: 'worker.maintenance.acquire',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Acquire an idle managed runtime lease and block new work',
})
export const workerMaintenanceActivateOperation = defineLegacyOperation({
  id: 'worker.maintenance.activate',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Activate a candidate managed runtime using its lease',
})
export const workerMaintenanceReleaseOperation = defineLegacyOperation({
  id: 'worker.maintenance.release',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Release a managed runtime lease and resume accepting work',
})
export const workerMaintenanceStatusOperation = defineLegacyOperation({
  id: 'worker.maintenance.status',
  kind: 'query',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Read the maintenance phase and activation id of a managed runtime',
})
export const workerMaintenanceStopOperation = defineLegacyOperation({
  id: 'worker.maintenance.stop',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Stop an idle managed runtime using its maintenance or activation lease',
})
export const workerWebAccessSetSecurityOperation = defineLegacyOperation({
  id: 'worker.webAccess.setSecurity',
  kind: 'command',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Change Web access security and revoke sessions (Desktop-managed Worker only)',
})
export const workerWebAccessSetSettingsOperation = defineLegacyOperation({
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
