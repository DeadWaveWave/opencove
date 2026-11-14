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
  expect(CONTROL_SURFACE_OPERATIONS.filter(op => op.contract === 'schema')).toHaveLength(154)
  expect(getControlSurfaceOperation('node.resolveCallerSelector')).toMatchObject({
    kind: 'query',
    contract: 'schema',
    scope: 'read',
  })
  expect(getControlSurfaceOperation('space.update')).toMatchObject({
    kind: 'command',
    contract: 'schema',
    scope: 'interact',
  })
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
  // The frozen oracle predates this opt-in field; legacy corpus inputs omit it.
  'session.launchAgent': payload => ({
    ...normalizeLaunchAgentPayload(payload),
    codexReuseRunningAppServer: null,
  }),
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
      if (id === 'node.create') {
        const parsed = nodeCreateOperation.input.safeParse(item.payload)
        expect(attempt(validators[id], item.payload)).toStrictEqual(
          parsed.success ? attempt(oracles[id], parsed.data) : { ok: false },
        )
        return
      }
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
  expect(
    Object.isFrozen(
      defineLegacyOperation({ ...meta, compat: 'control-surface-legacy-validation' }),
    ),
  ).toBe(true)
})

// Query kind describes dispatch, not whether the handler is side-effect-free.
it.each([
  ['endpoint.readDirectory', 'admin'],
  ['session.finalMessage', 'interact'],
  ['session.finalMessageForNode', 'interact'],
  ['plugin.sidebar.items', 'interact'],
] as const)('classifies side-effecting query %s as %s', (id, scope) => {
  expect(getControlSurfaceOperation(id)).toMatchObject({ kind: 'query', scope })
})

it('never lets a returning legacy normalizer override schema rejection', async () => {
  const { defineOperation } =
    await import('../../../src/shared/contracts/controlSurface/operations')
  const { createControlSurface } =
    await import('../../../src/app/main/controlSurface/controlSurface')
  const actual = createControlSurface()
  let dispatched = false
  registerOperation(
    actual,
    defineOperation({
      id: 'test.legacyAdmission',
      kind: 'command',
      scope: 'interact',
      availability: 'always',
      summary: 'Check schema admission.',
      input: z.object({ id: z.string() }),
      errors: [],
      normalize: wire => wire,
      legacyNormalize: () => ({ id: 'fallback' }),
      compat: 'control-surface-legacy-validation',
    }),
    {
      handle: () => {
        dispatched = true
      },
      defaultErrorCode: 'common.unexpected',
    },
  )
  const result = await actual.invoke(
    { now: () => new Date() } as Parameters<ControlSurface['invoke']>[0],
    {
      id: 'test.legacyAdmission',
      kind: 'command',
      payload: { id: 123 },
    },
  )
  expect(result).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
  expect(dispatched).toBe(false)
})

it('passes original own keys to legacy normalization after successful schema admission', async () => {
  const { defineOperation } =
    await import('../../../src/shared/contracts/controlSurface/operations')
  const payload = JSON.parse('{"id":"sample","__proto__":true}') as unknown
  const operation = defineOperation({
    id: 'test.rawKeys',
    kind: 'query',
    scope: 'read',
    availability: 'always',
    summary: 'Check raw payload preservation.',
    input: z.looseObject({ id: z.string() }),
    errors: [],
    normalize: wire => Object.keys(wire),
    compat: 'control-surface-legacy-validation',
    legacyNormalize: raw => {
      expect(raw).toBe(payload)
      return Object.keys(raw as object)
    },
  })
  expect(operation.input.safeParse(payload).success).toBe(true)
  registerOperation(surface, operation, {
    handle: () => undefined,
    defaultErrorCode: 'common.unexpected',
  })
  expect(validators[operation.id](payload)).toEqual(['id', '__proto__'])
})

it('describes every input field in words an agent can act on', () => {
  const problems: string[] = []
  const visit = (schema: unknown, path: string, field: string | null): void => {
    if (!schema || typeof schema !== 'object') {
      return
    }
    const node = schema as Record<string, unknown>
    const description = typeof node.description === 'string' ? node.description.trim() : null
    if (description !== null && field !== null) {
      const lowered = description.toLowerCase()
      if (
        description.length < 8 ||
        lowered === field.toLowerCase() ||
        lowered.startsWith(`${field.toLowerCase()}:`) ||
        /^(provide|perform|query|set) (the|a) (identifier|value|field)\b/i.test(description)
      ) {
        problems.push(`${path}: "${description}"`)
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value && typeof value === 'object') {
        for (const [name, child] of Object.entries(value)) {
          visit(child, `${path}.${name}`, name)
        }
      } else if (Array.isArray(value)) {
        value.forEach((child, index) => visit(child, `${path}[${index}]`, field))
      } else if (value && typeof value === 'object') {
        visit(value, `${path}.${key}`, field)
      }
    }
  }
  for (const op of CONTROL_SURFACE_OPERATIONS) {
    if (op.contract !== 'schema') {
      continue
    }
    visit(z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' }), op.id, null)
  }
  expect(problems).toEqual([])
})
