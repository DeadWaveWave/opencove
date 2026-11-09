// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import { nodeOperations } from '../../../src/shared/contracts/controlSurface/operations/domains/node'
import { canvasFocusOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/canvas'

const operations = [...nodeOperations, canvasFocusOperation]
const callers = [
  ['node.list', { projectId: 'p', space: { kind: 'spaceId', spaceId: 's' }, kind: 'task' }],
  ['node.list', {}],
  ['node.get', { nodeId: 'n' }],
  ['node.delete', { nodeId: 'n' }],
  ...['note', 'task', 'website', 'agent', 'terminal'].map(kind => [
    'node.create',
    {
      kind,
      projectId: 'p',
      space: { kind: 'spaceId', spaceId: 's' },
      title: undefined,
      frame: { x: 1, y: 2, width: 300, height: 200 },
      data:
        kind === 'task'
          ? { requirement: 'Fix', priority: 'high', status: 'doing', tags: ['a'] }
          : kind === 'website'
            ? { url: 'https://example.com', pinned: false, sessionMode: 'shared', profileId: null }
            : kind === 'agent'
              ? { provider: 'codex', model: null, prompt: 'hi' }
              : kind === 'terminal'
                ? { profileId: null, shell: null, command: 'pwd' }
                : { text: 'note' },
    },
  ]),
  ...['note', 'task', 'website'].map(kind => [
    'node.update',
    {
      nodeId: 'n',
      kind,
      title: null,
      frame: null,
      data:
        kind === 'task'
          ? { tags: [], status: 'done' }
          : kind === 'website'
            ? { pinned: true }
            : { text: 'after' },
    },
  ]),
  ['canvas.focus', { target: { kind: 'node', nodeId: 'n' } }],
  ...[
    { kind: 'spaceId', spaceId: 's' },
    { kind: 'spaceName', name: 'Main', projectId: 'p' },
    { kind: 'workerBranch', worker: 'local', branch: 'main', projectId: 'p' },
    { kind: 'workerPath', worker: 'local', path: '/repo', projectId: null },
  ].map(locator => ['canvas.focus', { target: { kind: 'space', locator } }]),
] as const

it.each(callers)('keeps internal %s caller payload valid: %j', (id, payload) => {
  const op = operations.find(candidate => candidate.id === id)!
  expect(op.input.safeParse(payload).success).toBe(true)
  expect(() => op.legacyNormalize!(payload)).not.toThrow()
})

it.each(callers)('rejects unknown root keys before handling %s: %j', async (id, payload) => {
  const op = operations.find(candidate => candidate.id === id)!
  const surface = createControlSurface()
  const handle = vi.fn()
  registerOperation(surface, op as Parameters<typeof registerOperation>[1], {
    handle,
    defaultErrorCode: 'common.unexpected',
  })
  const result = await surface.invoke(
    { now: () => new Date() },
    {
      id: op.id,
      kind: op.kind,
      payload: { ...payload, unexpected: true },
    },
  )
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'common.invalid_input',
      details: { issues: [{ path: ['unexpected'], allowedKeys: expect.any(Array) }] },
    },
  })
  expect(handle).not.toHaveBeenCalled()
})

it.each([
  ['node.create', { kind: 'note', data: { tex: 'hi' } }, ['data', 'tex'], ['text']],
  [
    'node.update',
    { nodeId: 'n', kind: 'task', data: { tag: ['a'] } },
    ['data', 'tag'],
    ['requirement', 'priority', 'status', 'tags'],
  ],
  [
    'node.create',
    { kind: 'note', frame: { wide: 4 } },
    ['frame', 'wide'],
    ['x', 'y', 'width', 'height'],
  ],
  [
    'node.list',
    { space: { kind: 'spaceId', spaceId: 's', extra: 1 } },
    ['space', 'extra'],
    ['kind', 'spaceId'],
  ],
  [
    'canvas.focus',
    { target: { kind: 'space', locator: { kind: 'spaceId', spaceId: 's', extra: 1 } } },
    ['target', 'locator', 'extra'],
    ['kind', 'spaceId'],
  ],
])('rejects nested unknown keys for %s', (id, input, path, allowedKeys) => {
  const op = operations.find(candidate => candidate.id === id)!
  expect(op.input.safeParse(input).success).toBe(false)
  expect(() => op.legacyNormalize!(input)).toThrow(
    expect.objectContaining({
      code: 'common.invalid_input',
      details: { issues: [expect.objectContaining({ path, allowedKeys })] },
    }),
  )
})

it.each(['agent', 'terminal'])(
  'accepts title/frame updates and rejects every data field for %s',
  kind => {
    const op = operations.find(candidate => candidate.id === 'node.update')!
    const input = { kind, nodeId: 'n', title: ' Lead ', frame: { x: 20, width: 400 } }
    expect(op.input.safeParse(input).success).toBe(true)
    expect(op.legacyNormalize!(input)).toMatchObject({ kind, title: 'Lead' })
    for (const data of [null, {}, { prompt: 'x' }, { command: 'pwd' }, { provider: 'codex' }]) {
      expect(op.input.safeParse({ ...input, data }).success).toBe(false)
      expect(() => op.legacyNormalize!({ ...input, data })).toThrow()
    }
    expect(op.input.safeParse({ kind, nodeId: 'n', frame: { x: 20 } }).success).toBe(true)
    for (const title of [null, '', '   ']) {
      expect(op.input.safeParse({ ...input, title }).success).toBe(false)
    }
  },
)
