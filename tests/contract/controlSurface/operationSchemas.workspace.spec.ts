// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { defineOperation } from '../../../src/shared/contracts/controlSurface/operations/defineOperation'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'

const documented: Record<string, [string[], string[]]> = {
  'canvas.focus': [['target'], ['target']],
  'node.delete': [['nodeId'], ['nodeId']],
  'node.get': [['nodeId'], ['nodeId']],
  'node.list': [['space', 'projectId', 'kind', 'spawnedByNodeId'], []],
  'node.update': [
    ['kind', 'nodeId', 'title', 'frame', 'data'],
    ['kind', 'nodeId'],
  ],
  'project.list': [[], []],
  'space.get': [['spaceId'], ['spaceId']],
  'space.list': [['projectId'], []],
  'worktree.archive': [['spaceId', 'force', 'deleteBranch'], ['spaceId']],
  'worktree.create': [['spaceId', 'name'], ['spaceId']],
  'worktree.list': [['projectId'], []],
}
interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}
function objectShapes(schema: JsonSchema): JsonSchema[] {
  return schema.type === 'object'
    ? [schema]
    : (schema.anyOf ?? schema.oneOf ?? []).flatMap(objectShapes)
}
function exported(id: string): JsonSchema {
  const op = getControlSurfaceOperation(id)
  if (op?.contract !== 'schema') {
    throw new Error(`Missing schema: ${id}`)
  }
  return z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' }) as JsonSchema
}
for (const [id, [properties, required]] of Object.entries(documented)) {
  it(`${id} exports documented properties and required fields`, () => {
    const shapes = objectShapes(exported(id))
    expect(shapes).toHaveLength(id === 'node.update' ? 5 : 1)
    if (id === 'node.update') {
      // Agent and terminal updates rename or move only; they never accept kind data.
      const titleOnly = shapes.filter(shape => !('data' in (shape.properties ?? {})))
      expect(titleOnly).toHaveLength(2)
    }
    const primary = shapes.find(shape => 'data' in (shape.properties ?? {})) ?? shapes[0]
    expect(Object.keys(primary.properties ?? {}).sort()).toEqual([...properties].sort())
    expect([...(primary.required ?? [])].sort()).toEqual([...required].sort())
  })
}
it('documents nested focus locators and update frame fields', () => {
  const target = objectShapes(exported('canvas.focus'))[0].properties!.target
  const targets = objectShapes(target)
  expect(targets.map(shape => shape.required)).toEqual([
    ['kind', 'nodeId'],
    ['kind', 'locator'],
  ])
  const locators = objectShapes(targets[1].properties!.locator)
  expect(locators.map(shape => shape.required)).toEqual([
    ['kind', 'spaceId'],
    ['kind', 'name'],
    ['kind', 'worker', 'branch'],
    ['kind', 'worker', 'path'],
  ])
  const frame = objectShapes(objectShapes(exported('node.update'))[0].properties!.frame)[0]
  expect(Object.keys(frame.properties!)).toEqual(['x', 'y', 'width', 'height'])
  expect(frame.required ?? []).toEqual([])
  expect(objectShapes(exported('node.get'))[0].properties!.nodeId.type).toBe('string')
  const force = objectShapes(exported('worktree.archive'))[0].properties!.force
  expect(force.type).toEqual(['boolean', 'null'])
})
it('does not let a returning legacy hook bypass wire rejection', () => {
  let validate!: (payload: unknown) => unknown
  const surface = {
    register(_id, handler) {
      validate = handler.validate
    },
  } as ControlSurface
  const operation = defineOperation({
    id: 'test.legacy',
    kind: 'query',
    scope: 'read',
    availability: 'always',
    summary: 'Test',
    input: z.object({ id: z.string() }),
    errors: [],
    normalize: wire => wire.id,
    legacyNormalize: () => 'must not admit invalid wire',
  })
  registerOperation(surface, operation, {
    handle: () => undefined,
    defaultErrorCode: 'common.unexpected',
  })
  expect(() => validate({ id: 42 })).toThrow(
    expect.objectContaining({ code: 'common.invalid_input' }),
  )
})
