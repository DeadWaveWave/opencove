// @vitest-environment node
import { expect, it } from 'vitest'
import { resolveCanvasSpawnIdentity } from '../../../src/app/main/controlSurface/resolveCanvasSpawnIdentity'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

const ctx = { requestAuth: { kind: 'bearer' } } as ControlSurfaceContext
const getStore = async () =>
  ({
    readAppState: async () => ({
      formatVersion: 1,
      activeWorkspaceId: 'p',
      workspaces: [
        {
          id: 'p',
          name: 'Project',
          path: '/repo',
          nodes: [
            {
              id: 'n',
              kind: 'terminal',
              title: 'Shell',
              position: { x: 0, y: 0 },
              width: 500,
              height: 400,
            },
          ],
          spaces: [{ id: 's', name: 'Main', nodeIds: ['n'] }],
        },
      ],
    }),
  }) as PersistenceStore
it('retains session authority without inventing a node for a standalone Space launch', async () => {
  expect(await resolveCanvasSpawnIdentity(ctx, { spaceId: 's' }, getStore)).toEqual({
    projectId: 'p',
    spaceId: 's',
    nodeId: null,
  })
})
it('resolves a real bound node and retains explicit preallocated node identities', async () => {
  expect(await resolveCanvasSpawnIdentity(ctx, { canvasNodeId: 'n' }, getStore)).toEqual({
    projectId: 'p',
    spaceId: 's',
    nodeId: 'n',
  })
  expect(
    await resolveCanvasSpawnIdentity(ctx, { canvasNodeId: 'reserved', spaceId: 's' }, getStore),
  ).toEqual({ projectId: 'p', spaceId: 's', nodeId: 'reserved' })
})

it('retains project-only authority and leaves unscoped cwd launches unchanged', async () => {
  expect(await resolveCanvasSpawnIdentity(ctx, { workspaceId: 'p' }, getStore)).toEqual({
    projectId: 'p',
    spaceId: '',
    nodeId: null,
  })
  expect(await resolveCanvasSpawnIdentity(ctx, { cwd: '/other' }, getStore)).toBeUndefined()
})
it('accepts a node-less delegated identity only from the hosting Worker bearer', async () => {
  const identity = { projectId: 'p', spaceId: 's', nodeId: null }
  expect(
    await resolveCanvasSpawnIdentity(ctx, { workerSpawnIdentity: identity }, getStore),
  ).toEqual({ ...identity, delegated: true })
  await expect(
    resolveCanvasSpawnIdentity(
      { ...ctx, requestAuth: { kind: 'cookie', webSessionGeneration: 0 } },
      { workerSpawnIdentity: identity },
      getStore,
    ),
  ).rejects.toMatchObject({ code: 'common.forbidden' })
})
