import { defineLegacyOperation } from '../defineOperation'
export const workerConfigGetOperation = defineLegacyOperation({
  id: 'worker.config.get',
  kind: 'query',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Query worker config get.',
})
export const workerConfigSetOperation = defineLegacyOperation({
  id: 'worker.config.set',
  kind: 'command',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Perform worker config set.',
})
export const workerMaintenanceAcquireOperation = defineLegacyOperation({
  id: 'worker.maintenance.acquire',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Perform worker maintenance acquire.',
})
export const workerMaintenanceActivateOperation = defineLegacyOperation({
  id: 'worker.maintenance.activate',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Perform worker maintenance activate.',
})
export const workerMaintenanceReleaseOperation = defineLegacyOperation({
  id: 'worker.maintenance.release',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Perform worker maintenance release.',
})
export const workerMaintenanceStatusOperation = defineLegacyOperation({
  id: 'worker.maintenance.status',
  kind: 'query',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Perform worker maintenance status.',
})
export const workerMaintenanceStopOperation = defineLegacyOperation({
  id: 'worker.maintenance.stop',
  kind: 'command',
  scope: 'admin',
  availability: 'managed-runtime',
  summary: 'Perform worker maintenance stop.',
})
export const workerWebAccessSetSecurityOperation = defineLegacyOperation({
  id: 'worker.webAccess.setSecurity',
  kind: 'command',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Perform worker web Access set Security.',
})
export const workerWebAccessSetSettingsOperation = defineLegacyOperation({
  id: 'worker.webAccess.setSettings',
  kind: 'command',
  scope: 'admin',
  availability: 'desktop-managed-worker',
  summary: 'Perform worker web Access set Settings.',
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
