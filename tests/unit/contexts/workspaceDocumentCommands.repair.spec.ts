import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  bindWorkspaceDocumentStore,
  mergeHydratedNodes,
  repairWorkspaceSpaces,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  WorkspaceSpaceState,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

function space(id: string, targetMountId: string | null): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/tmp/workspace',
    targetMountId,
    labelColor: null,
    nodeIds: [],
    rect: { x: 0, y: 0, width: 400, height: 300 },
  } as WorkspaceSpaceState
}

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: `/tmp/${id}`,
    nodes: [pixelNode({ title: id })],
    spaces: [space(`${id}-space`, null)],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

describe('repairWorkspaceSpaces', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [workspace('a'), workspace('b'), workspace('c')],
      activeWorkspaceId: 'a',
    })
  })

  afterEach(() => {
    bindWorkspaceDocumentStore(useAppStore)
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('applies every repaired workspace in one notification and leaves the others alone', () => {
    const before = useAppStore.getState().workspaces
    const repairedA = [space('a-space', 'mount-a')]
    const repairedB = [space('b-space', 'mount-b')]
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    repairWorkspaceSpaces(
      new Map([
        ['a', repairedA],
        ['b', repairedB],
      ]),
    )
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
    const after = useAppStore.getState()
    expect(after.workspaces[0].spaces).toBe(repairedA)
    expect(after.workspaces[1].spaces).toBe(repairedB)
    expect(after.workspaces[0].nodes).toBe(before[0].nodes)
    expect(after.workspaces[2]).toBe(before[2])
    expect(after.activeWorkspaceId).toBe('a')
  })

  it('writes nothing when no named workspace exists any more', () => {
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    repairWorkspaceSpaces(new Map([['gone', [space('x', 'mount')]]]))
    unsubscribe()

    expect(listener).not.toHaveBeenCalled()
  })

  it('refuses to run inside a recipe', () => {
    expect(() =>
      mergeHydratedNodes('a', nodes => {
        repairWorkspaceSpaces(new Map())
        return nodes
      }),
    ).toThrow('workspace document command ran inside a recipe')
  })
})
