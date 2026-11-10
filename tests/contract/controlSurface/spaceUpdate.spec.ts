// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { spaceUpdateOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/space'
import { sessionGrantRule } from '../../../src/app/main/controlSurface/http/sessionGrantPolicy'

it('declares an interact schema operation with explicit failure codes', () => {
  expect(getControlSurfaceOperation('space.update')).toBe(spaceUpdateOperation)
  expect(spaceUpdateOperation).toMatchObject({
    kind: 'command',
    scope: 'interact',
    contract: 'schema',
    availability: 'always',
  })
  expect(spaceUpdateOperation.errors).toEqual(
    expect.arrayContaining([
      'space.not_found',
      'persistence.invalid_state',
      'persistence.io_failed',
      'persistence.unavailable',
      'persistence.payload_too_large',
    ]),
  )
  expect(sessionGrantRule('space.update')).toEqual({ access: 'allow' })
})

it('publishes strict field-level wire schemas and partial numeric frames', () => {
  const schema = z.toJSONSchema(spaceUpdateOperation.input)
  expect(schema).toMatchObject({
    type: 'object',
    additionalProperties: false,
    required: ['spaceId'],
    properties: {
      spaceId: { type: 'string' },
      name: { type: 'string' },
      frame: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number', exclusiveMinimum: 0 },
          height: { type: 'number', exclusiveMinimum: 0 },
        },
      },
    },
  })
  expect(spaceUpdateOperation.input.safeParse({ spaceId: 's', frame: { x: -1.5 } }).success).toBe(
    true,
  )
})

it('normalizes names exactly like top-level creation and preserves zero coordinates', () => {
  const input = { spaceId: ' s ', name: ' Review ', frame: { x: 0, y: -0.5 } }
  expect(spaceUpdateOperation.normalize(spaceUpdateOperation.input.parse(input))).toEqual({
    spaceId: 's',
    name: 'Review',
    frame: { x: 0, y: -0.5 },
  })
  expect(input.name).toBe(' Review ')
})

it.each([
  { spaceId: 's' },
  { spaceId: 's', frame: {} },
  { spaceId: 's', name: 'Review', frame: {} },
  { spaceId: 's', frame: { x: undefined } },
])('keeps semantic rejection in the normalizer for %j', wire => {
  expect(spaceUpdateOperation.input.safeParse(wire).success).toBe(true)
  expect(() => spaceUpdateOperation.normalize(wire)).toThrow(
    expect.objectContaining({ code: 'common.invalid_input' }),
  )
})

it('exports only representable wire shape without cross-field checks', () => {
  const schema = z.toJSONSchema(spaceUpdateOperation.input, {
    io: 'input',
    unrepresentable: 'throw',
  })
  expect(schema).toMatchObject({
    required: ['spaceId'],
    properties: { frame: { type: 'object', additionalProperties: false } },
  })
  expect(spaceUpdateOperation.input.def.checks ?? []).toEqual([])
})

it('describes frame coordinates as boundary-only edits', () => {
  const schema = z.toJSONSchema(spaceUpdateOperation.input, {
    io: 'input',
    unrepresentable: 'throw',
  })
  expect(schema).toMatchObject({
    properties: {
      frame: {
        properties: {
          x: { description: expect.stringContaining('contents stay in place') },
          y: { description: expect.stringContaining('contents stay in place') },
        },
      },
    },
  })
  expect(spaceUpdateOperation.summary).toBe(
    'Rename a space or adjust its boundary around fixed contents',
  )
})
