// @vitest-environment node
import { expect, it, vi } from 'vitest'
import * as z from 'zod'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import { registerManagedRuntimeHandlers } from '../../../src/app/main/controlSurface/handlers/managedRuntimeHandlers'
import { registerWorkerConfigurationHandlers } from '../../../src/app/worker/workerConfigurationHandlers'
import { registerPluginDistributionHandlers } from '../../../src/app/main/controlSurface/handlers/pluginDistributionHandlers'
import { CONTROL_SURFACE_OPERATIONS } from '../../../src/shared/contracts/controlSurface/operations'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/shared/contracts/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'

vi.mock('zod', async importOriginal => {
  const actual = await importOriginal<typeof import('zod')>()
  return { ...actual, toJSONSchema: vi.fn(actual.toJSONSchema) }
})

const ctx = { now: () => new Date(), capabilities: {} } as ControlSurfaceContext
for (const variant of ['always', 'desktop-managed-worker', 'managed-runtime', 'debug'] as const) {
  it(`introspects actual composition: ${variant}`, async () => {
    vi.mocked(z.toJSONSchema).mockClear()
    const surface = createControlSurface()
    registerPluginDistributionHandlers(
      surface,
      {} as Parameters<typeof registerPluginDistributionHandlers>[1],
    )
    registerControlSurfaceHandlers(surface, {
      ptyRuntime: variant === 'debug' ? { debugCrashHost() {} } : {},
      plugins: { configureHost() {} },
      ptyStreamHub: {},
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
    const invoke = (id: string, payload: unknown = {}) =>
      surface.invoke(ctx, { kind: 'query', id, payload })
    const expected = CONTROL_SURFACE_OPERATIONS.filter(
      op => op.availability === 'always' || op.availability === variant,
    )
      .map(({ id, kind, scope, availability, contract, summary }) => ({
        id,
        kind,
        scope,
        availability,
        contract,
        summary,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    expect(await invoke('system.operations')).toEqual({
      __opencoveControlEnvelope: true,
      ok: true,
      value: { protocolVersion: CONTROL_SURFACE_PROTOCOL_VERSION, operations: expected },
    })
    expect(z.toJSONSchema).not.toHaveBeenCalled()
    await Promise.all(
      CONTROL_SURFACE_OPERATIONS.map(async op => {
        const result = await invoke('system.operation.describe', { id: op.id })
        if (!expected.some(item => item.id === op.id)) {
          expect(result).toMatchObject({
            ok: false,
            error: { code: 'common.invalid_input', debugMessage: expect.stringContaining(op.id) },
          })
        } else {
          expect(result).toMatchObject({
            ok: true,
            value: {
              id: op.id,
              inputSchema:
                op.contract === 'schema'
                  ? z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })
                  : null,
              errors: op.contract === 'schema' ? [...op.errors] : [],
            },
          })
        }
      }),
    )
    expect(await invoke('system.operation.describe', { id: 'unknown' })).toMatchObject({
      ok: false,
      error: { code: 'common.invalid_input', debugMessage: expect.stringContaining('unknown') },
    })
    expect(await invoke('system.operations', null)).toMatchObject({ ok: false })
    expect(await invoke('system.operation.describe', { id: 42 })).toMatchObject({ ok: false })
    vi.mocked(z.toJSONSchema).mockClear()
    const first = await invoke('system.operation.describe', { id: 'system.operations' })
    const second = await invoke('system.operation.describe', { id: 'system.operations' })
    if (!first.ok || !second.ok) {
      throw new Error('describe failed')
    }
    expect((first.value as { inputSchema: object }).inputSchema).toBe(
      (second.value as { inputSchema: object }).inputSchema,
    )
    expect(z.toJSONSchema).not.toHaveBeenCalled()
    expect(await invoke('system.capabilities')).toMatchObject({
      ok: true,
      value: { features: { operationRegistry: true } },
    })
  })
}
