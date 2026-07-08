import { describe, expect, it } from 'vitest'
import {
  canReorderSidebarDragItems,
  readSidebarDragItemData,
  type SidebarDragItemData,
} from './SidebarDnd'

describe('SidebarDnd', () => {
  it('keeps sortable item movement inside the allowed sidebar scope', () => {
    const projectA = { kind: 'project', workspaceId: 'workspace-a' } satisfies SidebarDragItemData
    const projectB = { kind: 'project', workspaceId: 'workspace-b' } satisfies SidebarDragItemData
    const spaceA1 = {
      kind: 'space',
      workspaceId: 'workspace-a',
      spaceId: 'space-1',
    } satisfies SidebarDragItemData
    const spaceA2 = {
      kind: 'space',
      workspaceId: 'workspace-a',
      spaceId: 'space-2',
    } satisfies SidebarDragItemData
    const spaceB = {
      kind: 'space',
      workspaceId: 'workspace-b',
      spaceId: 'space-1',
    } satisfies SidebarDragItemData
    const agentA1 = {
      kind: 'agent',
      workspaceId: 'workspace-a',
      groupId: 'group-a',
      nodeId: 'agent-1',
    } satisfies SidebarDragItemData
    const agentA2 = {
      kind: 'agent',
      workspaceId: 'workspace-a',
      groupId: 'group-a',
      nodeId: 'agent-2',
    } satisfies SidebarDragItemData
    const agentOtherGroup = {
      kind: 'agent',
      workspaceId: 'workspace-a',
      groupId: 'group-b',
      nodeId: 'agent-3',
    } satisfies SidebarDragItemData

    expect(canReorderSidebarDragItems(projectA, projectB)).toBe(true)
    expect(canReorderSidebarDragItems(spaceA1, spaceA2)).toBe(true)
    expect(canReorderSidebarDragItems(agentA1, agentA2)).toBe(true)

    expect(canReorderSidebarDragItems(projectA, spaceA1)).toBe(false)
    expect(canReorderSidebarDragItems(spaceA1, spaceB)).toBe(false)
    expect(canReorderSidebarDragItems(agentA1, agentOtherGroup)).toBe(false)
  })

  it('rejects malformed drag payloads', () => {
    expect(readSidebarDragItemData(null)).toBeNull()
    expect(readSidebarDragItemData({ kind: 'space', workspaceId: 'workspace-a' })).toBeNull()
    expect(readSidebarDragItemData({ kind: 'agent', workspaceId: 'workspace-a' })).toBeNull()
  })
})
