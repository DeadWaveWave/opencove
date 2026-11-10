import { expect, it, vi } from 'vitest'
import { createAppError } from '../../../src/shared/errors/appError'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSpaceHandlers } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { sessionGrantRule } from '../../../src/app/main/controlSurface/http/sessionGrantPolicy'

function fixture() {
  const state = normalizePersistedAppState({
    formatVersion: 1,
    activeWorkspaceId: 'p',
    settings: {},
    workspaces: [
      {
        id: 'p',
        name: 'Project',
        path: '/repo',
        nodes: [
          {
            id: 'n',
            kind: 'note',
            title: 'Note',
            position: { x: 80, y: 90 },
            width: 240,
            height: 180,
            task: { text: 'Keep' },
          },
          {
            id: 'nested',
            kind: 'note',
            title: 'Nested',
            position: { x: 370, y: 90 },
            width: 240,
            height: 180,
          },
          { id: 'other', kind: 'note', position: { x: -500, y: -500 }, width: 240, height: 180 },
        ],
        spaces: [
          {
            id: 'root',
            name: 'Root',
            directoryPath: '/repo',
            nodeIds: [],
            rect: { x: 0, y: 0, width: 1000, height: 800 },
          },
          {
            id: 's',
            parentSpaceId: 'root',
            name: 'Review',
            directoryPath: '/repo',
            nodeIds: ['n'],
            rect: { x: 40, y: 40, width: 700, height: 500 },
          },
          {
            id: 'child',
            parentSpaceId: 's',
            name: 'Child',
            directoryPath: '/repo',
            nodeIds: ['nested'],
            rect: { x: 340, y: 60, width: 300, height: 300 },
          },
        ],
      },
    ],
  })!
  let current = state
  let revision = 7
  const write = vi.fn(async (next: typeof state, options?: { expectedRevision?: number }) => {
    if (options?.expectedRevision !== revision) {
      return {
        ok: false as const,
        error: {
          code: 'persistence.invalid_state' as const,
          debugMessage: 'App state revision conflict',
        },
      }
    }
    current = next
    revision += 1
    return { ok: true as const, level: 'full' as const, bytes: 1, revision }
  })
  const store = {
    readAppState: async () => current,
    readAppStateRevision: async () => revision,
    writeAppState: write,
  } as unknown as PersistenceStore
  const surface = createControlSurface()
  registerSpaceHandlers(surface, async () => store)
  const invoke = (payload: unknown, context = {} as ControlSurfaceContext) =>
    surface.invoke(context, { kind: 'command', id: 'space.update', payload })
  return { invoke, write, state, current: () => current.workspaces[0] }
}

it('renames through one CAS and preserves directory, membership and geometry', async () => {
  const f = fixture()
  const result = await f.invoke({ spaceId: 's', name: '  New name  ' })
  expect(result).toMatchObject({
    ok: true,
    value: {
      id: 's',
      name: 'New name',
      projectId: 'p',
      parentSpaceId: 'root',
      directoryPath: '/repo',
      rect: { x: 40, y: 40, width: 700, height: 500 },
      movedNodeIds: [],
    },
  })
  expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.any(Object), { expectedRevision: 7 })
  expect(f.current().spaces[1]).toEqual({ ...f.state.workspaces[0].spaces[1], name: 'New name' })
})

it('encloses direct nodes and child spaces when shrinking without moving contents', async () => {
  const f = fixture()
  expect(await f.invoke({ spaceId: 's', frame: { width: 1, height: 1 } })).toMatchObject({
    ok: true,
    value: {
      frameAdjusted: true,
      appliedFrame: { x: 40, y: 40, width: 612, height: 332 },
      movedNodeIds: [],
    },
  })
  expect(f.current().nodes).toEqual(f.state.workspaces[0].nodes)
})

it('moves the full subtree exactly once and grows ancestors without moving other nodes', async () => {
  const f = fixture()
  expect(await f.invoke({ spaceId: 's', frame: { x: 900, y: 1000 } })).toMatchObject({
    ok: true,
    value: {
      frameAdjusted: false,
      appliedFrame: { x: 900, y: 1000, width: 700, height: 500 },
      movedNodeIds: ['n', 'nested'],
    },
  })
  expect(f.current().nodes.map(n => [n.id, n.position])).toEqual([
    ['n', { x: 940, y: 1050 }],
    ['nested', { x: 1230, y: 1050 }],
    ['other', { x: -500, y: -500 }],
  ])
  expect(f.current().spaces[2].rect).toEqual({ x: 1200, y: 1020, width: 300, height: 300 })
  expect(f.current().spaces[0].rect).toEqual({ x: 0, y: 0, width: 1612, height: 1512 })
  expect(f.state.workspaces[0].spaces[1].rect?.x).toBe(40)
})

it('grows every ancestor without translating descendants during resize', async () => {
  const f = fixture()
  expect(await f.invoke({ spaceId: 'child', frame: { width: 1400, height: 1200 } })).toMatchObject({
    ok: true,
    value: { frameAdjusted: false, movedNodeIds: [] },
  })
  expect(f.current().spaces[1].rect).toEqual({ x: 40, y: 40, width: 1712, height: 1232 })
  expect(f.current().spaces[0].rect).toEqual({ x: 0, y: 0, width: 1764, height: 1284 })
  expect(f.current().nodes).toEqual(f.state.workspaces[0].nodes)
})

it.each([
  {},
  { spaceId: 's' },
  { spaceId: ' ', name: 'New' },
  { spaceId: 's', name: '' },
  { spaceId: 's', name: '  ' },
  { spaceId: 's', frame: {} },
  ...[0, -1, Infinity, NaN, '5', null].map(width => ({ spaceId: 's', frame: { width } })),
  { spaceId: 's', frame: { x: 1, extra: true } },
  { spaceId: 's', name: 'New', directoryPath: '/other' },
])('rejects invalid wire input without writing: %j', async payload => {
  const f = fixture()
  expect(await f.invoke(payload)).toMatchObject({
    ok: false,
    error: { code: 'common.invalid_input' },
  })
  expect(f.write).not.toHaveBeenCalled()
})

it('reports a missing Space and permits session grants', async () => {
  const f = fixture()
  expect(await f.invoke({ spaceId: 'missing', name: 'New' })).toMatchObject({
    ok: false,
    error: { code: 'space.not_found' },
  })
  expect(f.write).not.toHaveBeenCalled()
  expect(sessionGrantRule('space.update')).toEqual({ access: 'allow' })
})

it.each(['persistence.invalid_state', 'persistence.io_failed'] as const)(
  'propagates %s without retrying the write',
  async code => {
    const f = fixture()
    f.write.mockResolvedValueOnce({
      ok: false,
      error: { code, debugMessage: 'App state revision conflict (expected 7, actual 8)' },
    } as never)
    expect(await f.invoke({ spaceId: 's', name: 'New' })).toMatchObject({
      ok: false,
      error: { code },
    })
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.current().spaces[1].name).toBe('Review')
  },
)

it('allows renaming legacy Spaces without rects but refuses a frame without a baseline', async () => {
  const f = fixture()
  f.state.workspaces[0].spaces[1].rect = null
  expect(await f.invoke({ spaceId: 's', name: 'Legacy' })).toMatchObject({
    ok: true,
    value: { name: 'Legacy', rect: null },
  })
  f.write.mockClear()
  expect(await f.invoke({ spaceId: 's', frame: { x: 10 } })).toMatchObject({
    ok: false,
    error: { code: 'common.invalid_input' },
  })
  expect(f.write).not.toHaveBeenCalled()
})

it('combines rename, translation and containment in a single immutable write', async () => {
  const f = fixture()
  expect(
    await f.invoke({
      spaceId: 's',
      name: 'Together',
      frame: { x: -100, y: -80, width: 1, height: 1 },
    }),
  ).toMatchObject({
    ok: true,
    value: {
      name: 'Together',
      frameAdjusted: true,
      appliedFrame: { x: -100, y: -80, width: 612, height: 332 },
      movedNodeIds: ['n', 'nested'],
    },
  })
  expect(f.current().spaces[0].rect).toEqual({ x: -112, y: -92, width: 1112, height: 892 })
  expect(f.write).toHaveBeenCalledTimes(1)
})

it('accepts any positive size for an empty Space and preserves unrequested dimensions', async () => {
  const f = fixture()
  f.state.workspaces[0].spaces.push({
    ...f.state.workspaces[0].spaces[0],
    id: 'empty',
    rect: { x: -100, y: 10, width: 50, height: 40 },
  })
  expect(await f.invoke({ spaceId: 'empty', frame: { width: 0.5 } })).toMatchObject({
    ok: true,
    value: {
      appliedFrame: { x: -100, y: 10, width: 0.5, height: 40 },
      frameAdjusted: false,
      movedNodeIds: [],
    },
  })
})

it('rejects arithmetic overflow without a partial rename or write', async () => {
  const f = fixture()
  expect(
    await f.invoke({
      spaceId: 's',
      name: 'Overflow',
      frame: { x: Number.MAX_VALUE, width: Number.MAX_VALUE },
    }),
  ).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
  expect(f.write).not.toHaveBeenCalled()
})

it('rechecks caller lifetime after asynchronous reads and before writing', async () => {
  const f = fixture()
  const assertActive = vi
    .fn()
    .mockImplementationOnce(() => undefined)
    .mockImplementation(() => {
      throw createAppError('common.forbidden')
    })
  expect(
    await f.invoke({ spaceId: 's', name: 'New' }, { assertActive } as ControlSurfaceContext),
  ).toMatchObject({ ok: false, error: { code: 'common.forbidden' } })
  expect(assertActive).toHaveBeenCalledTimes(2)
  expect(f.write).not.toHaveBeenCalled()
})

it.each(['missing-parent', 's'])(
  'refuses frame updates with invalid parent %s without losing the name',
  async parentSpaceId => {
    const f = fixture()
    f.state.workspaces[0].spaces[1].parentSpaceId = parentSpaceId
    expect(await f.invoke({ spaceId: 's', name: 'New', frame: { width: 900 } })).toMatchObject({
      ok: false,
      error: { code: 'common.invalid_input' },
    })
    expect(f.write).not.toHaveBeenCalled()
    expect(f.current().spaces[1].name).toBe('Review')
  },
)

it('allows one concurrent update to win without overwriting or replaying the other', async () => {
  const f = fixture()
  const results = await Promise.all([
    f.invoke({ spaceId: 's', name: 'Winner' }),
    f.invoke({ spaceId: 's', frame: { x: 900 } }),
  ])
  expect(results[0]).toMatchObject({ ok: true, value: { name: 'Winner' } })
  expect(results[1]).toMatchObject({ ok: false, error: { code: 'persistence.invalid_state' } })
  expect(f.current().spaces[1]).toEqual({ ...f.state.workspaces[0].spaces[1], name: 'Winner' })
  expect(f.current().nodes).toEqual(f.state.workspaces[0].nodes)
  expect(f.write).toHaveBeenCalledTimes(2)
})

it('preserves nonempty mount boundaries and worktree directory bindings during layout updates', async () => {
  const f = fixture()
  const target = f.state.workspaces[0].spaces[1]
  target.directoryPath = '/repo/worktrees/review'
  target.targetMountId = 'mount'
  target.boundary = {
    allowedMountIds: ['mount'],
    scopesByMountId: {
      mount: { rootPath: target.directoryPath, rootUri: 'file:///repo/worktrees/review' },
    },
    allowedPluginIds: ['plugin'],
    capabilities: ['filesystem'],
    trustLevel: 'restricted',
  }
  expect(await f.invoke({ spaceId: 's', name: 'New', frame: { x: 80 } })).toMatchObject({
    ok: true,
    value: { directoryPath: target.directoryPath },
  })
  expect(f.current().spaces[1]).toEqual({ ...target, name: 'New', rect: { ...target.rect, x: 80 } })
})
