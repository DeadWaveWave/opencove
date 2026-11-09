import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { createWorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { CreateNodeResult } from '../../../src/shared/contracts/dto/nodeControl'
import type { NodeControlAppState } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { writePersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/write'
import { applyLocalViewStateToPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/viewState'
import type { PersistedAppState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { installMockStorage } from '../../support/persistenceTestStorage'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import type { RequestAuth } from '../../../src/app/main/controlSurface/http/requestAuth'
import { SPACE_NODE_PADDING } from '../../../src/contexts/workspace/domain/workspaceSpaceLayout'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

it('joins CLI target selection to Worker membership, placement and persistence without a socket', async () => {
  const originalApi = window.opencoveApi
  installMockStorage()
  const root = await mkdtemp(join(tmpdir(), 'opencove-root-integration-'))
  try {
    const store = createInMemoryPersistenceStore()
    const initial = createMinimalState(root, 'project', 'space')
    initial.workspaces[0].viewport = { x: -8000, y: -6000, zoom: 2 }
    initial.workspaces[0].spaces[0].rect = { x: 0, y: 0, width: 1200, height: 900 }
    await store.writeAppState(initial)
    const topology = createWorkerTopologyStore({ userDataPath: root })
    await topology.createMount({ projectId: 'project', endpointId: 'local', rootPath: root })
    const surface = createControlSurface()
    registerNodeControlHandlers(surface, { topology, getPersistenceStore: async () => store })
    const ctx = { now: () => new Date(), requestAuth: undefined as RequestAuth | undefined }
    const seed = await surface.invoke(ctx, {
      kind: 'command',
      id: 'node.create',
      payload: {
        kind: 'note',
        space: { kind: 'spaceId', spaceId: 'space' },
        data: { text: 'Caller' },
      },
    })
    expect(seed.ok).toBe(true)
    if (!seed.ok) {
      throw new Error('Caller fixture creation failed')
    }
    const caller = (seed.value as CreateNodeResult).node.id
    const published = (await store.readAppState()) as PersistedAppState
    published.workspaces[0].viewport = { x: -8000, y: -6000, zoom: 2 }
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        persistence: {
          writeAppState: async ({ state }: { state: unknown }) => store.writeAppState(state),
        },
      },
    })
    expect((await writePersistedState(published)).ok).toBe(true)
    const workerState = (await store.readAppState()) as NodeControlAppState
    expect(workerState.workspaces[0].viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(applyLocalViewStateToPersistedState(published).workspaces[0].viewport).toEqual({
      x: -8000,
      y: -6000,
      zoom: 2,
    })
    const grant = new SessionGrantRegistry(() => true).issue({
      projectId: 'project',
      spaceId: 'stale-space',
      nodeId: caller,
      sessionId: 'fixture-session',
    }).grant
    ctx.requestAuth = { kind: 'session-grant', grant }

    let stdout = '',
      stderr = ''
    const io: CliIo = {
      stdout: {
        write: s => {
          stdout += s
        },
      },
      stderr: {
        write: s => {
          stderr += s
        },
      },
      env: {
        OPENCOVE_ENV: '1',
        OPENCOVE_PROJECT_ID: 'project',
        OPENCOVE_SPACE_ID: 'space',
        OPENCOVE_NODE_ID: caller,
        OPENCOVE_CONTROL_URL: 'http://in-memory',
        OPENCOVE_CONTROL_TOKEN: 'fixture',
      },
      fetch: async (_url, init) =>
        new Response(JSON.stringify(await surface.invoke(ctx, JSON.parse(String(init?.body))))),
      now: Date.now,
      readTextFile: async () => '',
      readStdinText: async () => '',
    }
    const execute = async (args: string[]) => {
      stdout = ''
      stderr = ''
      expect(await run(args, io), stderr).toBe(0)
      return JSON.parse(stdout)
    }
    const explicit = (await execute([
      'node',
      'create',
      'note',
      '--root-canvas',
      '--text',
      'Root',
    ])) as CreateNodeResult
    expect(explicit.node.frame).toMatchObject({
      x: 1200 + SPACE_NODE_PADDING,
      y: (seed.value as CreateNodeResult).node.frame.y,
    })
    expect(explicit.node.spaceId).toBeNull()
    const inSpace = (await execute(['node', 'create', 'note'])) as CreateNodeResult
    expect(inSpace.spaceId).toBe('space')
    // Move the caller after spawn while retaining the old environment identity.
    const state = (await store.readAppState()) as NodeControlAppState
    state.workspaces[0].spaces[0].nodeIds = state.workspaces[0].spaces[0].nodeIds.filter(
      id => id !== caller,
    )
    await store.writeAppState(state)
    const implicit = (await execute(['node', 'create', 'note'])) as CreateNodeResult
    expect(implicit.spaceId).toBeNull()
    const listed = await execute(['node', 'list', '--kind', 'note'])
    expect(listed.nodes.map((node: { id: string }) => node.id)).toEqual(
      expect.arrayContaining([caller, inSpace.node.id, explicit.node.id, implicit.node.id]),
    )
    const roots = await execute(['node', 'list', '--root-canvas'])
    expect(roots.nodes.map((node: { id: string }) => node.id)).toEqual([
      caller,
      explicit.node.id,
      implicit.node.id,
    ])
    const persisted = (await store.readAppState()) as NodeControlAppState
    expect(persisted.workspaces[0].spaces[0].nodeIds).toEqual([inSpace.node.id])
  } finally {
    Object.defineProperty(window, 'opencoveApi', { configurable: true, value: originalApi })
    await rm(root, { recursive: true, force: true })
  }
})
