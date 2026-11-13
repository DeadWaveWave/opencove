import type { ManagedRuntimeMaintenance } from '../../../../contexts/topology/application/ManagedRuntimeMaintenance'
import {
  workerMaintenanceAcquireOperation,
  workerMaintenanceActivateOperation,
  workerMaintenanceReleaseOperation,
  workerMaintenanceStopOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/worker'
import { normalizeMaintenancePayload } from '../../../../shared/contracts/controlSurface/operations/managedRuntimeNormalize'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'

export function registerManagedRuntimeHandlers(
  surface: ControlSurface,
  options: {
    maintenance: ManagedRuntimeMaintenance
    instanceId: string
    requestShutdown: () => void
  },
): void {
  surface.register('worker.maintenance.status', {
    kind: 'query',
    validate: () => null,
    handle: () => ({
      phase: options.maintenance.phase,
      instanceId: options.instanceId,
      activationId: options.maintenance.activationId,
    }),
    defaultErrorCode: 'common.unavailable',
  })
  const operations = {
    acquire: workerMaintenanceAcquireOperation,
    release: workerMaintenanceReleaseOperation,
    stop: workerMaintenanceStopOperation,
    activate: workerMaintenanceActivateOperation,
  } as const
  for (const action of ['acquire', 'release', 'stop', 'activate'] as const) {
    const normalize = (payload: unknown) => normalizeMaintenancePayload(payload, options.instanceId)
    registerOperation(
      surface,
      // @compat control-surface-legacy-validation
      { ...operations[action], normalize, legacyNormalize: normalize },
      {
        handle: (_ctx, { lease }) => {
          if (action === 'acquire') {
            return { acquired: options.maintenance.acquire(lease) }
          }
          if (action === 'release') {
            options.maintenance.release(lease)
          }
          if (action === 'activate') {
            options.maintenance.activate(lease)
          }
          if (action === 'stop') {
            options.maintenance.commitStop(lease)
            // Let the command acknowledgement flush before the listener starts draining.
            setImmediate(options.requestShutdown)
          }
          return { ok: true }
        },
        defaultErrorCode: 'common.unavailable',
      },
    )
  }
}
