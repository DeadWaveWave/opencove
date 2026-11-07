import { registerPluginDistributionHandlers } from '../../../src/app/main/controlSurface/handlers/pluginDistributionHandlers'
// @vitest-environment node
import { expect, it } from 'vitest'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import { registerManagedRuntimeHandlers } from '../../../src/app/main/controlSurface/handlers/managedRuntimeHandlers'
import { registerWorkerConfigurationHandlers } from '../../../src/app/worker/workerConfigurationHandlers'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { CONTROL_SURFACE_OPERATIONS } from '../../../src/shared/contracts/controlSurface/operations'

for (const variant of ['always', 'desktop-managed-worker', 'managed-runtime', 'debug'] as const) {
  it(`matches real registrations for ${variant}`, () => {
    const registered = new Map<string, string>()
    const surface = {
      register(id, handler) {
        expect(registered.has(id)).toBe(false)
        registered.set(id, handler.kind)
      },
    } as ControlSurface
    registerPluginDistributionHandlers(
      surface,
      {} as Parameters<typeof registerPluginDistributionHandlers>[1],
    )
    registerControlSurfaceHandlers(surface, {
      ptyRuntime: variant === 'debug' ? { debugCrashHost() {} } : {},
      plugins: { configureHost() {} },
      ptyStreamHub: { agentRuns: { registry: { onDispose() {} } } },
    } as Parameters<typeof registerControlSurfaceHandlers>[1])
    if (variant === 'desktop-managed-worker') {
      registerWorkerConfigurationHandlers(
        surface,
        {} as Parameters<typeof registerWorkerConfigurationHandlers>[1],
      )
    }
    if (variant === 'managed-runtime') {
      registerManagedRuntimeHandlers(
        surface,
        {} as Parameters<typeof registerManagedRuntimeHandlers>[1],
      )
    }
    const expected = new Map(
      CONTROL_SURFACE_OPERATIONS.filter(
        op => op.availability === 'always' || op.availability === variant,
      ).map(op => [op.id, op.kind]),
    )
    expect(registered).toEqual(expected)
  })
}
