import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  renameTarget,
  setTargetLabelColor,
} from '../../../src/app/renderer/shell/components/ProjectContextMenu.state'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import type {
  WorkspaceSpaceState,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from '../contexts/workspacePixelLayer.fixtures'

function createWorkspace(id: string): WorkspaceState {
  const agentNode = pixelNode({
    kind: 'agent',
    title: 'codex · model',
    agent: { provider: 'codex' } as never,
  })
  return {
    id,
    name: `${id} name`,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    nodes: [{ ...agentNode, id: 'agent-1' }],
    spaces: [
      {
        id: 'space-1',
        name: 'Space',
        directoryPath: `/tmp/${id}`,
        targetMountId: null,
        labelColor: null,
        nodeIds: ['agent-1'],
        rect: { x: 0, y: 0, width: 400, height: 300 },
      } as WorkspaceSpaceState,
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: false,
  }
}

const spaceTarget = { kind: 'space', workspaceId: 'a', spaceId: 'space-1' } as const
const agentTarget = { kind: 'agent', workspaceId: 'a', nodeId: 'agent-1' } as const

describe('project context menu writes to the target workspace', () => {
  let listener: ReturnType<typeof vi.fn>
  let unsubscribe: () => void

  beforeEach(() => {
    useAppStore.setState({
      workspaces: [createWorkspace('a'), createWorkspace('b')],
      activeWorkspaceId: 'b',
    })
    listener = vi.fn()
    unsubscribe = useAppStore.subscribe(listener)
  })

  afterEach(() => {
    unsubscribe()
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  function expectOnlyWorkspaceAChanged(workspaceBBefore: WorkspaceState): void {
    expect(listener).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().workspaces[1]).toBe(workspaceBBefore)
    expect(useAppStore.getState().workspaces[0]).not.toBe(workspaceBBefore)
  }

  it('renames a Space in the target workspace with one notification', () => {
    const before = useAppStore.getState().workspaces[1]
    renameTarget(spaceTarget, '  Renamed  ')
    expectOnlyWorkspaceAChanged(before)
    expect(useAppStore.getState().workspaces[0].spaces[0].name).toBe('Renamed')
  })

  it('renames an agent title in the target workspace with one notification', () => {
    const before = useAppStore.getState().workspaces[1]
    renameTarget(agentTarget, 'Renamed')
    expectOnlyWorkspaceAChanged(before)
    const node = useAppStore.getState().workspaces[0].nodes[0]
    expect(node.data.title).toContain('Renamed')
    expect(node.data.titlePinnedByUser).toBe(true)
  })

  it('sets a Space label colour in the target workspace with one notification', () => {
    const before = useAppStore.getState().workspaces[1]
    setTargetLabelColor(spaceTarget, 'red')
    expectOnlyWorkspaceAChanged(before)
    expect(useAppStore.getState().workspaces[0].spaces[0].labelColor).toBe('red')
  })

  it('sets an agent label colour in the target workspace with one notification', () => {
    const before = useAppStore.getState().workspaces[1]
    setTargetLabelColor(agentTarget, 'red')
    expectOnlyWorkspaceAChanged(before)
    expect(useAppStore.getState().workspaces[0].nodes[0].data.labelColorOverride).toBe('red')
  })

  it('writes nothing for the same name or the same colour', () => {
    renameTarget(spaceTarget, 'Renamed')
    setTargetLabelColor(spaceTarget, 'red')
    setTargetLabelColor(agentTarget, 'red')
    renameTarget(agentTarget, 'Renamed')
    listener.mockClear()
    const before = useAppStore.getState().workspaces

    renameTarget(spaceTarget, 'Renamed')
    setTargetLabelColor(spaceTarget, 'red')
    setTargetLabelColor(agentTarget, 'red')
    renameTarget(agentTarget, 'Renamed')

    expect(listener).not.toHaveBeenCalled()
    expect(useAppStore.getState().workspaces).toBe(before)
  })

  it('still renames the project through the store setter', () => {
    renameTarget({ kind: 'project', workspaceId: 'a' }, 'Project A')
    expect(useAppStore.getState().workspaces[0].name).toBe('Project A')
    expect(useAppStore.getState().workspaces[1].name).toBe('b name')
  })
})
