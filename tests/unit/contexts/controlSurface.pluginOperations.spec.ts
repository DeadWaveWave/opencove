// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import { pluginOperations } from '../../../src/shared/contracts/controlSurface/operations/domains/plugin'
import { registerPluginHandlers } from '../../../src/app/main/controlSurface/handlers/pluginHandlers'
import { registerPluginCommandHandlers } from '../../../src/app/main/controlSurface/handlers/pluginCommandHandlers'
import { registerPluginDistributionHandlers } from '../../../src/app/main/controlSurface/handlers/pluginDistributionHandlers'
import { registerPluginHandlers as legacyPlugins } from '../../support/controlSurfaceLegacyOracles/pluginHandlers'
import { registerPluginCommandHandlers as legacyCommands } from '../../support/controlSurfaceLegacyOracles/pluginCommandHandlers'
import { registerPluginDistributionHandlers as legacyDistribution } from '../../support/controlSurfaceLegacyOracles/pluginDistributionHandlers'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'

function capture(legacy: boolean) {
  const validators: Record<string, (value: unknown) => unknown> = {}
  const surface = {
    register(id, handler) {
      validators[id] = handler.validate
    },
  } as ControlSurface
  const plugins = {} as Parameters<typeof registerPluginHandlers>[1]
  ;(legacy ? legacyPlugins : registerPluginHandlers)(surface, plugins)
  ;(legacy ? legacyCommands : registerPluginCommandHandlers)(surface, {
    plugins,
    getPersistenceStore: async () => {
      throw new Error('must not access persistence')
    },
  })
  ;(legacy ? legacyDistribution : registerPluginDistributionHandlers)(
    surface,
    {} as Parameters<typeof registerPluginDistributionHandlers>[1],
  )
  return validators
}
const actual = capture(false)
const frozen = capture(true)
const valid: Record<string, unknown> = {
  'plugin.list': null,
  'plugin.details': { pluginId: 'sample' },
  'plugin.reload': { pluginId: 'sample' },
  'plugin.uninstall': { pluginId: 'sample' },
  'plugin.setEnabled': { pluginId: 'sample', enabled: false },
  'plugin.install': { directory: '/repo/plugin' },
  'plugin.git.install': { repository: 'https://github.com/example/plugin.git' },
  'plugin.git.check': { pluginId: 'sample' },
  'plugin.git.update': { pluginId: 'sample', ref: 'main' },
  'plugin.git.apply': { candidateId: 'candidate' },
  'plugin.source': { pluginId: 'sample' },
  'plugin.rollback': { pluginId: 'sample', revision: 'revision' },
  'plugin.discover': { query: '' },
  'plugin.window.open': { pluginId: 'sample', anchor: { x: 1, y: 2 } },
  'plugin.window.list': { pluginId: 'sample' },
  'plugin.command.run': { pluginId: 'sample', commandId: 'select' },
  'plugin.skill.get': { pluginId: 'sample', skillId: 'review' },
}
function attempt(validate: (value: unknown) => unknown, value: unknown) {
  try {
    return { ok: true, value: validate(value) }
  } catch (error) {
    // Compare the complete enumerable AppError descriptor, not just rejection.
    return { ok: false, error: { ...(error as object) }, message: (error as Error).message }
  }
}
const edges = [
  undefined,
  null,
  true,
  false,
  0,
  NaN,
  Infinity,
  [],
  {},
  '',
  ' ',
  '-flag',
  'x'.repeat(5000),
]
for (const op of pluginOperations) {
  // View, preference, host, and Sidebar payloads have a separate session and plugin parity suite.
  if (op.contract !== 'schema' || !(op.id in valid)) {
    continue
  }
  it(`${op.id}: strict JSON Schema export`, () => {
    expect(() => z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })).not.toThrow()
    expect(op.errors).toEqual(['plugin.operation_failed'])
  })
  const seed = valid[op.id] as Record<string, unknown> | null
  const cases: unknown[] = [valid[op.id], ...edges, { ...seed, extra: true }]
  const keys = new Set([
    ...Object.keys(seed ?? {}),
    'pluginId',
    'projectId',
    'nodeId',
    'spaceId',
    'anchor',
    'params',
    'context',
    'expectedRevision',
    'expectedRuntimeGeneration',
    'build',
    'ref',
    'directory',
  ])
  for (const key of keys) {
    const missing = { ...seed }
    delete missing[key]
    cases.push(missing)
    for (const edge of edges) {
      cases.push({ ...seed, [key]: edge })
    }
  }
  cases.push(
    JSON.parse(
      JSON.stringify({ marker: true, ...seed }).replace('"marker":true', '"__proto__":true'),
    ),
    { ...seed, pluginId: ' sample ' },
    { ...seed, anchor: { x: 1, y: 2, extra: true } },
    { ...seed, anchor: { x: NaN, y: Infinity } },
    { ...seed, context: { surface: ['commandCenter'] } },
    { ...seed, context: { surface: 'node', projectId: 'first', nodeIds: [' n ', 'n'] } },
    { ...seed, params: { bad: undefined } },
    { ...seed, build: { kind: 'pnpm', script: 'build', outputDirectory: 'dist' } },
    { ...seed, repository: '/repo/local plugin', directory: '.', ref: 'main' },
  )
  cases.forEach((payload, index) =>
    it(`${op.id}: parity ${index}`, () => {
      expect(attempt(actual[op.id], payload)).toStrictEqual(attempt(frozen[op.id], payload))
    }),
  )
}

for (const op of pluginOperations) {
  if (op.contract !== 'schema' || op.id === 'plugin.list' || !(op.id in valid)) {
    continue
  }
  it(`${op.id}: wire schema enforces object fields and exports their constraints`, () => {
    expect(op.input.safeParse(valid[op.id]).success).toBe(true)
    for (const payload of [[], 123, 'payload']) {
      expect(op.input.safeParse(payload).success).toBe(false)
    }
    const schema = z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })
    if (op.id === 'plugin.discover') {
      expect(op.input.safeParse(null).success).toBe(true)
      expect(op.input.safeParse(undefined).success).toBe(true)
      expect(op.input.safeParse({ query: 123 }).success).toBe(false)
      expect(schema.anyOf).toContainEqual(
        expect.objectContaining({ type: 'object', properties: { query: { type: 'string' } } }),
      )
    } else {
      expect(op.input.safeParse(null).success).toBe(false)
      expect(op.input.safeParse({}).success).toBe(false)
      expect(schema.type).toBe('object')
      const required = Object.keys(valid[op.id] as object).filter(
        key => !['ref', 'anchor'].includes(key),
      )
      expect(schema.required).toHaveLength(required.length)
      expect(schema.required).toEqual(expect.arrayContaining(required))
      for (const key of schema.required ?? []) {
        expect(schema.properties?.[key]).toEqual(
          expect.objectContaining({ type: key === 'enabled' ? 'boolean' : 'string' }),
        )
        expect(op.input.safeParse({ ...(valid[op.id] as object), [key]: 123 }).success).toBe(false)
        const missing = { ...(valid[op.id] as Record<string, unknown>) }
        delete missing[key]
        expect(op.input.safeParse(missing).success).toBe(false)
      }
    }
    expect(schema.anyOf ?? []).not.toContainEqual({})
  })
}
