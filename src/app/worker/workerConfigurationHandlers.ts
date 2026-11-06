import {
  workerConfigGetOperation,
  workerConfigSetOperation,
  workerWebAccessSetSecurityOperation,
  workerWebAccessSetSettingsOperation,
} from '../../shared/contracts/controlSurface/operations/domains/worker'
import type { ControlSurface } from '../main/controlSurface/controlSurface'
import { registerOperation } from '../main/controlSurface/registerOperation'
import type { WorkerConfigurationOwner } from './workerConfigurationOwner'

export function registerWorkerConfigurationHandlers(
  controlSurface: ControlSurface,
  owner: WorkerConfigurationOwner,
): void {
  registerOperation(controlSurface, workerConfigGetOperation, {
    handle: async () => await owner.getSnapshot(),
    defaultErrorCode: 'worker.unavailable',
  })
  registerOperation(controlSurface, workerConfigSetOperation, {
    handle: async (_ctx, payload) => await owner.setConfig(payload),
    defaultErrorCode: 'worker.unavailable',
  })
  registerOperation(controlSurface, workerWebAccessSetSettingsOperation, {
    handle: async (_ctx, payload) => await owner.setWebUiSettings(payload),
    defaultErrorCode: 'worker.unavailable',
  })
  registerOperation(controlSurface, workerWebAccessSetSecurityOperation, {
    handle: async (_ctx, payload) => await owner.setWebUiSecurity(payload),
    defaultErrorCode: 'worker.unavailable',
  })
}
