// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import { registerSpaceHandlers } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'
import type { UpdateNodeResult } from '../../../src/shared/contracts/dto'
import type { NodeControlAppState } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { isRectInsideRect } from '../../../src/contexts/space/application/spaceContainment'
import { concurrentNote } from '../../unit/contexts/nodeControlNear.helpers'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

it.each([false, true])(
  'commits node and ancestor growth through the existing update contract (missing rects=%s)',
  async missing => {
    const store = createInMemoryPersistenceStore(),
      surface = createControlSurface()
    const initial = createMinimalState('/repo', 'project', 'space') as NodeControlAppState
    const w = initial.workspaces[0]
    w.nodes = [
      { ...concurrentNote('note-node'), position: { x: 24, y: 24 }, width: 300, height: 200 },
    ]
    w.spaces[0] = {
      ...w.spaces[0],
      nodeIds: ['note-node'],
      parentSpaceId: 'parent',
      rect: missing ? null : { x: 0, y: 0, width: 348, height: 248 },
    }
    w.spaces.push({
      ...w.spaces[0],
      id: 'parent',
      nodeIds: [],
      parentSpaceId: null,
      rect: missing ? null : { x: -24, y: -24, width: 396, height: 296 },
    })
    await store.writeAppState(initial)
    const writes = vi.spyOn(store, 'writeAppState')
    // Updating does not route a runtime or need a mount/endpoint lookup.
    registerNodeControlHandlers(surface, {
      topology: {} as WorkerTopologyStore,
      getPersistenceStore: async () => store,
    })
    registerSpaceHandlers(surface, async () => store)
    const ctx = { now: () => new Date() }
    const updated = await surface.invoke(ctx, {
      kind: 'command',
      id: 'node.update',
      payload: { nodeId: 'note-node', kind: 'note', frame: { x: 1000, y: -1000 } },
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) {
      throw new Error(JSON.stringify(updated.error))
    }
    const result = updated.value as UpdateNodeResult
    expect(Object.keys(result)).toEqual(['revision', 'node'])
    expect(result).toMatchObject({
      revision: 2,
      node: {
        id: 'note-node',
        spaceId: 'space',
        frame: { x: 1000, y: -1000, width: 300, height: 200 },
      },
    })
    expect(writes).toHaveBeenCalledTimes(1)
    expect(writes.mock.calls[0][1]).toEqual({ expectedRevision: 1 })
    const saved = (await store.readAppState()) as NodeControlAppState
    const spaces = saved.workspaces[0].spaces
    expect(spaces[0].rect).not.toBeNull()
    expect(isRectInsideRect({ x: 976, y: -1024, width: 348, height: 248 }, spaces[0].rect!)).toBe(
      true,
    )
    expect(
      isRectInsideRect(
        {
          x: spaces[0].rect!.x - 24,
          y: spaces[0].rect!.y - 24,
          width: spaces[0].rect!.width + 48,
          height: spaces[0].rect!.height + 48,
        },
        spaces[1].rect!,
      ),
    ).toBe(true)
    expect(spaces.map(space => space.nodeIds)).toEqual([['note-node'], []])
    const read = await surface.invoke(ctx, {
      kind: 'query',
      id: 'space.get',
      payload: { spaceId: 'space' },
    })
    expect(read).toMatchObject({
      ok: true,
      value: { space: { id: 'space', rect: spaces[0].rect } },
    })
    expect(await store.readAppStateRevision()).toBe(result.revision)
  },
)
