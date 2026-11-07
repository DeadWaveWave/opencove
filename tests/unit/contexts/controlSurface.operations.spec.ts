// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import {
  CONTROL_SURFACE_OPERATIONS,
  getControlSurfaceOperation,
} from '../../../src/shared/contracts/controlSurface/operations'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { normalizeCreatePayload } from '../../support/controlSurfaceLegacyOracles/node'
import { normalizeLaunchAgentPayload } from '../../support/controlSurfaceLegacyOracles/session'
import { normalizeWriteFileTextPayload } from '../../support/controlSurfaceLegacyOracles/filesystem'
import { corpus } from '../../support/controlSurfaceLegacyOracles/corpus'
import { nodeCreateOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/node'
import { sessionLaunchAgentOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/session'
import { filesystemWriteFileTextOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/filesystem'

it('has unique, complete metadata and strictly exportable wire schemas', () => {
  expect(new Set(CONTROL_SURFACE_OPERATIONS.map(op => op.id)).size).toBe(
    CONTROL_SURFACE_OPERATIONS.length,
  )
  expect(CONTROL_SURFACE_OPERATIONS.filter(op => op.contract === 'schema')).toHaveLength(5)
  for (const op of CONTROL_SURFACE_OPERATIONS) {
    expect(Object.isFrozen(op)).toBe(true)
    expect(getControlSurfaceOperation(op.id)).toBe(op)
    expect(op.summary.trim().length).toBeGreaterThan(0)
    expect(['read', 'interact', 'admin']).toContain(op.scope)
    expect(['always', 'desktop-managed-worker', 'managed-runtime', 'debug']).toContain(
      op.availability,
    )
    if (op.contract === 'schema') {
      expect(() =>
        z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' }),
      ).not.toThrow()
    }
  }
})
const validators: Record<string, (payload: unknown) => unknown> = {}
const surface = {
  register(id, handler) {
    validators[id] = handler.validate
  },
} as ControlSurface
registerOperation(surface, nodeCreateOperation, {
  handle: () => undefined,
  defaultErrorCode: 'common.unexpected',
})
registerOperation(surface, sessionLaunchAgentOperation, {
  handle: () => undefined,
  defaultErrorCode: 'agent.launch_failed',
})
registerOperation(surface, filesystemWriteFileTextOperation, {
  handle: () => undefined,
  defaultErrorCode: 'common.unexpected',
})
const oracles: Record<string, (payload: unknown) => unknown> = {
  'node.create': normalizeCreatePayload,
  'session.launchAgent': normalizeLaunchAgentPayload,
  'filesystem.writeFileText': normalizeWriteFileTextPayload,
}
function attempt(parse: (payload: unknown) => unknown, payload: unknown) {
  try {
    return { ok: true, value: parse(payload) }
  } catch {
    return { ok: false }
  }
}
for (const [id, cases] of Object.entries(corpus)) {
  for (const [index, item] of cases.entries()) {
    it(`${id} ${index}: ${item.name}`, () => {
      expect(attempt(validators[id], item.payload)).toStrictEqual(
        attempt(oracles[id], item.payload),
      )
    })
  }
}

it('preserves invalid_input envelopes and never reports received values', async () => {
  const { createControlSurface } =
    await import('../../../src/app/main/controlSurface/controlSurface')
  const actual = createControlSurface()
  registerOperation(actual, sessionLaunchAgentOperation, {
    handle: () => {
      throw new Error('must not run')
    },
    defaultErrorCode: 'agent.launch_failed',
  })
  const secret = 'private-prompt-token'
  const results = await Promise.all(
    [{ cwd: '/repo', prompt: { secret } }, { prompt: secret }].map(payload =>
      actual.invoke({ now: () => new Date() } as Parameters<ControlSurface['invoke']>[0], {
        id: 'session.launchAgent',
        kind: 'command',
        payload,
      }),
    ),
  )
  for (const result of results) {
    expect(result).toMatchObject({
      __opencoveControlEnvelope: true,
      ok: false,
      error: { code: 'common.invalid_input' },
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  }
})

it('defaults normalization to identity and freezes constructors', async () => {
  const { defineOperation, defineLegacyOperation } =
    await import('../../../src/shared/contracts/controlSurface/operations')
  const meta = {
    id: 'test.identity',
    kind: 'query',
    scope: 'read',
    summary: 'Read a value.',
    availability: 'always',
  } as const
  const op = defineOperation({ ...meta, input: z.string(), errors: [] })
  expect(op.normalize('value')).toBe('value')
  expect(Object.isFrozen(op)).toBe(true)
  expect(Object.isFrozen(defineLegacyOperation(meta))).toBe(true)
})

// Query kind describes dispatch, not whether the handler is side-effect-free.
it.each([
  ['endpoint.readDirectory', 'admin'],
  ['session.finalMessage', 'interact'],
  ['plugin.sidebar.items', 'interact'],
] as const)('classifies side-effecting query %s as %s', (id, scope) => {
  expect(getControlSurfaceOperation(id)).toMatchObject({ kind: 'query', scope })
})
