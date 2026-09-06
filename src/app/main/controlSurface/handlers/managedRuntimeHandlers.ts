import type { ManagedRuntimeMaintenance } from '../../../../contexts/topology/application/ManagedRuntimeMaintenance'
import type { ControlSurface } from '../controlSurface'

export function registerManagedRuntimeHandlers(
  surface: ControlSurface,
  options: {
    maintenance: ManagedRuntimeMaintenance
    instanceId: string
    requestShutdown: () => void
  },
): void {
  const validate = (value: unknown): { lease: string } => {
    if (!value || typeof value !== 'object') {
      throw new Error('Expected maintenance request.')
    }
    const record = value as Record<string, unknown>
    if (
      record.instanceId !== options.instanceId ||
      typeof record.lease !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(record.lease)
    ) {
      throw new Error('Invalid maintenance target or lease.')
    }
    return { lease: record.lease }
  }
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
  for (const action of ['acquire', 'release', 'stop', 'activate'] as const) {
    surface.register(`worker.maintenance.${action}`, {
      kind: 'command',
      validate,
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
    })
  }
}
