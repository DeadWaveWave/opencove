import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ControlSurface } from '../controlSurface'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../../shared/contracts/controlSurface'
import type {
  ControlSurfaceHomeDirectoryResult,
  ControlSurfaceCapabilitiesResult,
  ControlSurfacePingResult,
} from '../../../../shared/contracts/dto'
import { resolveHomeDirectory } from '../../../../platform/os/HomeDirectory'

function readAppVersion(): string | null {
  try {
    const packageJsonPath = resolve(__dirname, '../../../../package.json')
    const raw = readFileSync(packageJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const version = (parsed as Record<string, unknown>).version
    return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null
  } catch {
    return null
  }
}

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

  controlSurface.register('system.homeDirectory', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: ctx =>
      ({
        ok: true,
        now: ctx.now().toISOString(),
        pid: process.pid,
        platform: process.platform,
        homeDirectory: resolveHomeDirectory(),
      }) satisfies ControlSurfaceHomeDirectoryResult,
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('system.capabilities', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: ctx =>
      ({
        ok: true,
        now: ctx.now().toISOString(),
        pid: process.pid,
        protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION,
        appVersion: readAppVersion(),
        features: ctx.capabilities,
      }) satisfies ControlSurfaceCapabilitiesResult,
    defaultErrorCode: 'common.unexpected',
  })
}
