import { noInputOracles as oracles } from '../../support/controlSurfaceLegacyOracles/noInputOperations'
// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerControlSurfaceHandlers } from '../../../src/app/main/controlSurface/registerControlSurfaceHandlers'
import { registerManagedRuntimeHandlers } from '../../../src/app/main/controlSurface/handlers/managedRuntimeHandlers'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import { defineOperation } from '../../../src/shared/contracts/controlSurface/operations/defineOperation'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import {
  requiredInfrastructureOperations,
  legacyNoInputOperations,
} from '../../support/controlSurfaceInfrastructureOperations'

it('accounts for every infrastructure operation, independently of the global count', () => {
  expect(requiredInfrastructureOperations).toHaveLength(35)
  expect(new Set(requiredInfrastructureOperations).size).toBe(35)
  const limitations: readonly string[] = legacyNoInputOperations
  for (const id of requiredInfrastructureOperations) {
    expect(getControlSurfaceOperation(id)?.contract, id).toBe(
      limitations.includes(id) ? 'legacy' : 'schema',
    )
  }
})

const validators: Record<string, (payload: unknown) => unknown> = {}
const surface = {
  register(id, handler) {
    validators[id] = handler.validate
  },
} as ControlSurface
registerControlSurfaceHandlers(surface, {
  ptyRuntime: {},
  plugins: { configureHost() {} },
  ptyStreamHub: {},
} as Parameters<typeof registerControlSurfaceHandlers>[1])
registerManagedRuntimeHandlers(surface, { instanceId: 'instance-1' } as Parameters<
  typeof registerManagedRuntimeHandlers
>[1])

for (const id of legacyNoInputOperations) {
  for (const payload of [undefined, null, true, 1, NaN, Infinity, '', [], { extra: true }]) {
    it(`${id} proves strict empty input cannot preserve legacy admission: ${JSON.stringify(payload)}`, () => {
      expect(validators[id](payload)).toStrictEqual(oracles[id](payload))
      let candidate: ((payload: unknown) => unknown) | undefined
      registerOperation(
        {
          register(_id, handler) {
            candidate = handler.validate
          },
        } as ControlSurface,
        defineOperation({
          id,
          kind: 'query',
          scope: 'read',
          availability: 'always',
          summary: 'Check empty payload compatibility',
          input: z.strictObject({}),
          normalize: oracles[id],
          legacyNormalize: oracles[id],
          errors: [],
        }),
        { handle: () => undefined, defaultErrorCode: 'common.unexpected' },
      )
      // A returning legacy hook must not override the schema's rejection.
      expect(() => candidate?.(payload)).toThrow()
    })
  }
}
