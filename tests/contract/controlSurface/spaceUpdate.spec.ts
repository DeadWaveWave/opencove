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
