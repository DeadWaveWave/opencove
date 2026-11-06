// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { resolveCanvasSpawnIdentity } from '../../../src/app/main/controlSurface/resolveCanvasSpawnIdentity'
import { canvasSpawnIdentity } from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import { invokeControlSurface } from '../../../src/app/main/controlSurface/remote/controlSurfaceHttpClient'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const ctx = createControlSurfaceHttpServerContext({
  enableWebShell: false,
  ptyProtocolVersion: 1,
  replayWindowMaxBytes: 10,
})
it('derives existing identity from Worker records and rejects spoofed project/space and grant-supplied node IDs', async () => {
  const store = createInMemoryPersistenceStore()
  const state = createMinimalState('/tmp', 'p', 's')
  const workspace = state.workspaces[0]
  Object.assign(workspace, {
    nodes: [
      {
        id: 'n',
        kind: 'terminal',
        title: 'shell',
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        sessionId: 'old',
      },
    ],
  })
  Object.assign(workspace.spaces[0], { nodeIds: ['n'] })
  await store.writeAppState(state)
  expect(await resolveCanvasSpawnIdentity(ctx, { canvasNodeId: 'n' }, async () => store)).toEqual({
    projectId: 'p',
    spaceId: 's',
    nodeId: 'n',
  })
  await expect(
    resolveCanvasSpawnIdentity(ctx, { canvasNodeId: 'n', workspaceId: 'other' }, async () => store),
  ).rejects.toMatchObject({ code: 'common.invalid_input' })
  await expect(
    resolveCanvasSpawnIdentity(
      ctx,
      { canvasNodeId: 'new', workspaceId: 'p', spaceId: 'other' },
      async () => store,
    ),
  ).rejects.toMatchObject({ code: 'common.invalid_input' })
  const grantCtx = {
    ...ctx,
    requestAuth: {
      kind: 'session-grant' as const,
      grant: {
        projectId: 'p',
        spaceId: 's',
        nodeId: 'n',
        sessionId: 'session',
        grantId: 'grant',
        tier: 'interact' as const,
        createdAt: '',
      },
    },
  }
  await expect(
    resolveCanvasSpawnIdentity(grantCtx, { canvasNodeId: 'n' }, async () => store),
  ).rejects.toMatchObject({ code: 'common.forbidden' })
})

it('forwards only Worker-owned spawn context and requires bearer authority at the hosting Worker', async () => {
  const identity = { projectId: 'home-project', spaceId: 'home-space', nodeId: 'home-node' }
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          __opencoveControlEnvelope: true,
          ok: true,
          value: { sessionId: 'remote' },
        }),
      ),
  )
  vi.stubGlobal('fetch', fetchMock)
  try {
    await canvasSpawnIdentity.run(identity, () =>
      invokeControlSurface(
        { hostname: 'remote', port: 1234, token: 'host-worker-token' },
        {
          kind: 'command',
          id: 'pty.spawn',
          payload: { cwd: '/remote', workerSpawnIdentity: { nodeId: 'spoof' } },
        },
      ),
    )
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const request = JSON.parse(options.body as string)
    expect(request.payload.workerSpawnIdentity).toEqual(identity)
    const noStore = vi.fn()
    expect(
      await resolveCanvasSpawnIdentity(
        { ...ctx, requestAuth: { kind: 'bearer' } },
        request.payload,
        noStore,
      ),
    ).toEqual(identity)
    expect(noStore).not.toHaveBeenCalled()
    await expect(
      resolveCanvasSpawnIdentity(
        { ...ctx, requestAuth: { kind: 'cookie', webSessionGeneration: 0 } },
        request.payload,
        noStore,
      ),
    ).rejects.toMatchObject({ code: 'common.forbidden' })
    await canvasSpawnIdentity.run(identity, () =>
      invokeControlSurface(
        { hostname: 'remote', port: 1234, token: 'host-worker-token' },
        { kind: 'query', id: 'system.ping', payload: {} },
      ),
    )
    const pingOptions = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(pingOptions.body as string).payload).toEqual({})
  } finally {
    vi.unstubAllGlobals()
  }
})
