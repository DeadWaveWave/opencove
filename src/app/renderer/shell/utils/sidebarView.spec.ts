import { describe, expect, it } from 'vitest'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import {
  DEFAULT_SIDEBAR_VIEW_SETTINGS,
  type SidebarViewSettings,
} from '@contexts/settings/domain/sidebarViewSettings'
import type { SidebarProjectTreeModel } from './sidebarTree'
import type { SidebarAgentItemModel } from './sidebarAgents'
import { projectSidebarView } from './sidebarView'

function agent(id: string, status: SidebarAgentItemModel['status']): SidebarAgentItemModel {
  return {
    displayTitle: id,
    effectiveLabelColor: null,
    owningSpace: null,
    status,
    node: {
      id,
      position: { x: 0, y: 0 },
      data: {
        kind: 'agent',
        agent: { provider: id === 'claude' ? 'claude-code' : 'codex' },
      } as TerminalNodeData,
    },
  }
}

function tree(): SidebarProjectTreeModel {
  return {
    workspace: { id: 'project' } as SidebarProjectTreeModel['workspace'],
    projectRootGroup: {
      id: 'project-root',
      kind: 'project-root',
      name: 'Root',
      labelColor: null,
      space: null,
      agents: [agent('root', 'standby')],
    },
    spaceGroups: [
      {
        id: 'space',
        kind: 'space',
        name: 'Space',
        labelColor: null,
        space: null,
        agents: [agent('codex', 'waiting'), agent('claude', 'working')],
      },
      { id: 'empty', kind: 'space', name: 'Empty', labelColor: null, space: null, agents: [] },
    ],
    agentCount: 3,
    workingAgentCount: 1,
  }
}

describe('Sidebar view projection', () => {
  it('shows hidden Agents in All mode without writing the source tree', () => {
    const source = tree()
    const view: SidebarViewSettings = {
      ...DEFAULT_SIDEBAR_VIEW_SETTINGS,
      hiddenAgentIds: { 'project:codex': true },
      mode: 'all',
    }
    const result = projectSidebarView(source, view)
    expect(result.tree.spaceGroups.map(group => group.id)).toEqual(['space', 'empty'])
    expect(result.tree.spaceGroups[0].sidebarHidden).toBe(false)
    expect(result.tree.spaceGroups[0].agents).toHaveLength(2)
    expect(result.tree.spaceGroups[0].agents[0].sidebarHidden).toBe(true)
    expect(result.hiddenWaitingCount).toBe(1)
    expect(source.spaceGroups[0].agents).toHaveLength(2)
    expect(source.spaceGroups[0].agents[0].sidebarHidden).toBeUndefined()
    expect(result.tree.projectRootGroup.agents).toHaveLength(1)
  })

  it('keeps parent hide authoritative while preserving each Agent’s own preference', () => {
    const view = {
      ...DEFAULT_SIDEBAR_VIEW_SETTINGS,
      hiddenSpaceIds: { 'project:space': true },
      hiddenAgentIds: { 'project:codex': true },
    }
    const hidden = projectSidebarView(tree(), view)
    expect(hidden.tree.spaceGroups.map(group => group.id)).toEqual(['empty'])
    expect(hidden.hiddenWaitingCount).toBe(1)
    const all = projectSidebarView(tree(), { ...view, mode: 'all' })
    expect(
      all.tree.spaceGroups[0].agents.every(item => item.sidebarHidden && item.sidebarHiddenBySpace),
    ).toBe(true)
    const restored = projectSidebarView(tree(), { ...view, hiddenSpaceIds: {} })
    expect(restored.tree.spaceGroups[0].agents.map(item => item.node.id)).toEqual(['claude'])
  })

  it('keeps empty hidden Spaces recoverable and counts attention regardless of active filters', () => {
    const result = projectSidebarView(tree(), {
      ...DEFAULT_SIDEBAR_VIEW_SETTINGS,
      hiddenSpaceIds: { 'project:empty': true },
      hiddenAgentIds: { 'project:codex': true },
      mode: 'all',
    })
    expect(result.tree.spaceGroups.map(group => group.id)).toEqual(['space', 'empty'])
    expect(result.tree.spaceGroups[1].sidebarHidden).toBe(true)
    expect(result.matchingAgentCount).toBe(3)
    expect(result.hiddenWaitingCount).toBe(1)
  })

  it('focus mode keeps pinned Spaces and pinned Agents while excluding hidden items', () => {
    const source = tree()
    source.spaceGroups[0].space = { id: 'space', pinned: true } as never
    const result = projectSidebarView(source, {
      ...DEFAULT_SIDEBAR_VIEW_SETTINGS,
      mode: 'focus',
      hiddenAgentIds: { 'project:claude': true },
      pinnedAgentIds: { 'project:root': true },
    })

    expect(result.tree.spaceGroups.map(group => group.id)).toEqual(['space'])
    expect(result.tree.spaceGroups[0].agents.map(agentItem => agentItem.node.id)).toEqual(['codex'])
    expect(result.tree.projectRootGroup.agents.map(agentItem => agentItem.node.id)).toEqual([
      'root',
    ])
  })

  it('focus mode keeps an unpinned Space when one of its Agents is pinned', () => {
    const result = projectSidebarView(tree(), {
      ...DEFAULT_SIDEBAR_VIEW_SETTINGS,
      mode: 'focus',
      pinnedAgentIds: { 'project:claude': true },
    })

    expect(result.tree.spaceGroups.map(group => group.id)).toEqual(['space'])
    expect(result.tree.spaceGroups[0].agents.map(agentItem => agentItem.node.id)).toEqual([
      'claude',
    ])
  })
})
