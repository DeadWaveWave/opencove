import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSpaceHandlers } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { toShellWorkspaceStateForSync } from '../../../src/app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync'
import type { PersistedWorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createInMemoryPersistenceStore } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

it('joins granted CLI selectors, Worker updates, saved geometry and renderer sync without a socket', async () => {
  const store = createInMemoryPersistenceStore()
  await store.writeAppState({
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: {},
    workspaces: [
      {
        id: 'project',
        name: 'Project',
        path: '/repo',
        nodes: [
          {
            id: 'note',
            kind: 'note',
            title: 'Brief',
            position: { x: 50, y: 60 },
            width: 240,
            height: 180,
            task: { text: 'Preserve' },
          },
        ],
        spaces: [
          {
            id: 'space',
            name: 'Draft',
            directoryPath: '/repo',
            nodeIds: ['note'],
            rect: { x: 0, y: 0, width: 800, height: 600 },
          },
        ],
      },
    ],
  })
  const surface = createControlSurface()
  registerSpaceHandlers(surface, async () => store)
  const { grant } = new SessionGrantRegistry(() => true).issue({
    projectId: 'project',
    spaceId: 'space',
    nodeId: 'caller',
    sessionId: 'session',
  })
  const ctx = {
    ...createControlSurfaceHttpServerContext({
      enableWebShell: false,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 10,
    }),
    requestAuth: { kind: 'session-grant' as const, grant },
  }
  let stdout = '',
    stderr = ''
  const io: CliIo = {
    stdout: {
      write: text => {
        stdout += text
      },
    },
    stderr: {
      write: text => {
        stderr += text
      },
    },
    env: {
      OPENCOVE_ENV: '1',
      OPENCOVE_PROJECT_ID: 'project',
      OPENCOVE_SPACE_ID: 'space',
      OPENCOVE_CONTROL_URL: 'http://in-memory',
      OPENCOVE_CONTROL_TOKEN: 'grant',
    },
    fetch: async (_url, init) =>
      new Response(JSON.stringify(await surface.invoke(ctx, JSON.parse(String(init?.body))))),
    now: Date.now,
    readTextFile: async () => '',
    readStdinText: async () => '',
  }
  const initial = normalizePersistedAppState(await store.readAppState())!
  const before = initial.workspaces[0] as unknown as PersistedWorkspaceState
  const existing = toShellWorkspaceStateForSync(before, undefined)
  expect(
    await run(
      [
        'space',
        'update',
        '--space',
        'Draft',
        '--name',
        'Review',
        '--frame',
        '{"x":100,"width":1,"height":1}',
      ],
      io,
    ),
    stderr,
  ).toBe(0)
  expect(JSON.parse(stdout)).toMatchObject({
    id: 'space',
    name: 'Review',
    movedNodeIds: ['note'],
    frameAdjusted: true,
    appliedFrame: { x: 100, y: 0, width: 314, height: 264 },
  })
  expect(stderr).toContain('Notice: space frame adjusted; applied frame:')
  expect(await store.readAppStateRevision()).toBe(2)

  // A fresh hydration uses only the serialized saved snapshot.
  const restored = normalizePersistedAppState(
    JSON.parse(JSON.stringify(await store.readAppState())),
  )!
  expect(restored.workspaces[0].spaces[0]).toMatchObject({
    id: 'space',
    name: 'Review',
    directoryPath: '/repo',
    nodeIds: ['note'],
    rect: { x: 100, y: 0, width: 314, height: 264 },
  })
  const merged = toShellWorkspaceStateForSync(
    restored.workspaces[0] as unknown as PersistedWorkspaceState,
    existing,
    before,
  )
  expect(merged.spaces[0]).toMatchObject({
    name: 'Review',
    rect: { x: 100, y: 0, width: 314, height: 264 },
  })
  expect(merged.nodes[0].position).toEqual({ x: 150, y: 60 })
  expect(merged.nodes[0].data.note).toMatchObject({ text: 'Preserve' })
})
