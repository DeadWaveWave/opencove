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
  it('preserves ordering and a parent Space for matching hidden Agents without writing the source', () => {
    const source = tree()
    const view: SidebarViewSettings = {
      ...DEFAULT_SIDEBAR_VIEW_SETTINGS,
      hiddenAgentIds: { 'project:codex': true },
      filters: { status: 'waiting', provider: 'codex', visibility: 'hidden' },
    }
    const result = projectSidebarView(source, view)
    expect(result.tree.spaceGroups.map(group => group.id)).toEqual(['space'])
    expect(result.tree.spaceGroups[0].sidebarHidden).toBe(false)
    expect(result.tree.spaceGroups[0].agents).toHaveLength(1)
    expect(result.tree.spaceGroups[0].agents[0]).toMatchObject({
      sidebarHidden: true,
      sidebarHiddenBySpace: false,
    })
    expect(result.hiddenWaitingCount).toBe(1)
    expect(source.spaceGroups[0].agents).toHaveLength(2)
    expect(source.spaceGroups[0].agents[0].sidebarHidden).toBeUndefined()
    expect(result.tree.projectRootGroup.agents).toHaveLength(0)
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
    const all = projectSidebarView(tree(), {
      ...view,
      filters: { ...view.filters, visibility: 'all' },
    })
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
      filters: { status: 'all', provider: 'all', visibility: 'hidden' },
    })
    expect(result.tree.spaceGroups.map(group => group.id)).toEqual(['space', 'empty'])
    expect(result.tree.spaceGroups[1].sidebarHidden).toBe(true)
    expect(result.matchingAgentCount).toBe(1)
    const working = projectSidebarView(tree(), {
      ...DEFAULT_SIDEBAR_VIEW_SETTINGS,
      hiddenAgentIds: { 'project:codex': true },
      filters: { status: 'working', provider: 'claude-code', visibility: 'visible' },
    })
    expect(working.hiddenWaitingCount).toBe(1)
  })
})
