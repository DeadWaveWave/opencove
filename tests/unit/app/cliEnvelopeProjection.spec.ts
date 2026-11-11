// @vitest-environment node
import { expect, it } from 'vitest'
import { rawRenderSpec, render, validateRenderOptions } from '../../../src/app/cli/core/render'

const spec = {
  itemKey: 'resource',
  fields: ['id', 'reply', 'reply.message', 'outcome'],
  projectedEnvelopeFields: ['reply', 'reply.message', 'outcome'],
}
const value = {
  revision: 7,
  resource: { id: 'r', secret: 'hidden' },
  outcome: 'completed',
  reply: { message: 'Answer', source: 'hook' },
}
it.each([
  ['id', { resource: { id: 'r' } }],
  ['resource.id,reply.message', { resource: { id: 'r' }, reply: { message: 'Answer' } }],
  ['reply', { resource: {}, reply: value.reply }],
])(
  'keeps envelope metadata while projecting declared item and envelope fields: %s',
  (fields, selected) => {
    expect(JSON.parse(render(value, { fields }, spec))).toEqual({ revision: 7, ...selected })
    expect(value.resource.secret).toBe('hidden')
  },
)
it('keeps the complete result without projection and rejects undeclared fields in preflight', () => {
  expect(JSON.parse(render(value, {}, spec))).toEqual(value)
  expect(() => validateRenderOptions({ fields: 'reply.secret' }, spec)).toThrow('Unknown fields')
})
it('maps envelope fields to their root paths for raw introspection', () => {
  expect(rawRenderSpec(spec).aliases).toMatchObject({
    id: 'resource.id',
    'reply.message': 'reply.message',
  })
})

it('does not report projected envelope fields as absent node content', async () => {
  const { nodeFieldNotice } = await import('../../../src/app/cli/core/nodeFields')
  expect(
    nodeFieldNotice(
      { node: { kind: 'agent', id: 'n' }, reply: { message: 'Answer' } },
      { fields: 'id,reply.message' },
      { ...spec, itemKey: 'node' },
    ),
  ).toBeUndefined()
})
