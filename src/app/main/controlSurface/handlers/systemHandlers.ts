import type { ControlSurface } from '../controlSurface'
import type { ControlSurfacePingResult } from '../../../../shared/contracts/dto'

export function registerSystemHandlers(controlSurface: ControlSurface): void {
  controlSurface.register('system.ping', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: ctx =>
      ({
        ok: true,
        now: ctx.now().toISOString(),
        pid: process.pid,
      }) satisfies ControlSurfacePingResult,
    defaultErrorCode: 'common.unexpected',
  })
}
