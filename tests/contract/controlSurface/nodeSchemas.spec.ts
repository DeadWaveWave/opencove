// @vitest-environment node
import { expect, it } from 'vitest'
import * as z from 'zod'
import {
  nodeCreateOperation as create,
  nodeUpdateOperation as update,
} from '../../../src/shared/contracts/controlSurface/operations/domains/node'
// Compare the entire wire schema without a multi-thousand-line pretty-printed golden.
expect.addSnapshotSerializer({
  test: value => !!value && typeof value === 'object' && '$schema' in value,
  serialize: value => JSON.stringify(value),
})
it.each([create, update])('$id exports a strict JSON Schema', op => {
  expect(z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })).toMatchSnapshot()
})
// CLI and pluginCanvasHost both forward these same kind-specific data objects.
it.each([
  { kind: 'note', data: { text: 'Markdown 中文' } },
  { kind: 'note', space: null, title: undefined, frame: undefined, data: undefined },
  { kind: 'task', data: { requirement: 'Fix', priority: 'urgent', status: 'doing', tags: ['a'] } },
  {
    kind: 'website',
    data: { url: 'example.com', pinned: false, sessionMode: 'profile', profileId: 'p' },
  },
  { kind: 'agent', data: { prompt: 'hi', provider: 'codex', model: null } },
  { kind: 'terminal', data: { shell: null, command: 'pwd', profileId: null } },
])('accepts caller create payload %j', input => {
  expect(
    create.input.safeParse({
      projectId: 'p',
      space: { kind: 'spaceId', spaceId: 's' },
      title: null,
      frame: { x: 1, width: null },
      ...input,
    }).success,
  ).toBe(true)
})
it.each([
  { kind: 'task' },
  { kind: 'task', data: { requirement: ' ' } },
  { kind: 'task', data: { requirement: 'x', priority: 'bad' } },
  { kind: 'website', data: {} },
  { kind: 'note', data: { text: 1 } },
  { kind: 'agent', data: { provider: 'bad' } },
  { kind: 'terminal', data: { command: 1 } },
  { kind: 'note', title: 1 },
  { kind: 'note', projectId: 1 },
  { kind: 'note', frame: { x: '1' } },
])('rejects invalid create payload %j', input =>
  expect(create.input.safeParse(input).success).toBe(false),
)
it.each([
  { kind: 'note', data: { text: 'after' } },
  { kind: 'task', data: { tags: [], status: 'done' } },
  { kind: 'website', data: { url: 'https://example.com', sessionMode: 'shared', profileId: null } },
  { kind: 'note', title: '-draft', frame: null, data: null },
])('accepts caller update payload %j', input =>
  expect(update.input.safeParse({ nodeId: 'n', ...input }).success).toBe(true),
)
it.each([
  { kind: 'agent', data: {} },
  { kind: 'agent', data: { agentFullAccess: true } },
  { kind: 'agent', data: { agentFullAccess: false } },
  { kind: 'agent', agentFullAccess: true },
  { kind: 'terminal', data: null },
  { kind: 'task', data: { tags: [1] } },
  { kind: 'website', data: { pinned: 'true' } },
  { kind: 'note', data: { text: false } },
])('rejects unsupported update payload %j', input =>
  expect(update.input.safeParse({ nodeId: 'n', ...input }).success).toBe(false),
)

it('types the top-level spaceId alias and normalizes it without competing locators', () => {
  expect(create.input.safeParse({ kind: 'note', spaceId: 3 }).success).toBe(false)
  const wire = create.input.parse({ kind: 'note', spaceId: 's' })
  expect(create.normalize(wire).space).toEqual({ kind: 'spaceId', spaceId: 's' })
  expect(() =>
    create.normalize(
      create.input.parse({
        kind: 'note',
        spaceId: 's',
        space: { kind: 'spaceId', spaceId: 'other' },
      }),
    ),
  ).toThrow(
    expect.objectContaining({
      code: 'common.invalid_input',
      debugMessage: 'Use either spaceId or space, not both.',
    }),
  )
})
