// @vitest-environment node
import { expect, it } from 'vitest'
import { render, validateRenderOptions } from '../../../src/app/cli/core/render'
it('projects declared aliases into their real envelope paths', () => {
  const spec = { fields: ['id', 'turnId', 'reply.message'], aliases: { id: 'node.id' } }
  expect(
    JSON.parse(
      render(
        {
          node: { id: 'n', title: 'Agent' },
          turnId: 't',
          reply: { message: 'Answer', source: 'hook' },
        },
        { fields: 'id,reply.message' },
        spec,
      ),
    ),
  ).toEqual({ node: { id: 'n' }, reply: { message: 'Answer' } })
  expect(() => validateRenderOptions({ fields: 'reply.secret' }, spec)).toThrow('Unknown fields')
})
