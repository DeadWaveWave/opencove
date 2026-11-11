import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import type { Value } from './model'
export function fixture(owned: boolean): PersistedAppState {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: structuredClone(DEFAULT_AGENT_SETTINGS),
    workspaces: [
      ensurePersistedWorkspace({
        id: 'project',
        name: 'Project',
        path: '/tmp/convergence',
        spaces: [
          {
            id: 'space',
            name: 'Tasks',
            directoryPath: '/tmp/convergence',
            nodeIds: ['terminal'],
            rect: null,
          },
        ],
        nodes: [
          {
            id: 'agent',
            kind: 'agent',
            title: 'Claude',
            sessionId: 'runtime',
            position: { x: 0, y: 0 },
            width: 500,
            height: 400,
            ...(owned
              ? {
                  managedClaudeResumeBindingOwnership: {
                    activationId: 'activation',
                    runtimeSessionId: 'runtime',
                  },
                }
              : {}),
            agent: {
              provider: 'claude-code',
              executionDirectory: '/tmp/convergence',
              prompt: 'Review',
              resumeSessionId: 'A',
              resumeSessionIdVerified: true,
            },
          },
          {
            id: 'terminal',
            kind: 'terminal',
            sessionId: 'terminal-runtime',
            title: 'Terminal',
            position: { x: 600, y: 0 },
            width: 500,
            height: 400,
            scrollback: null,
          },
        ],
      })!,
    ],
  }
}
export function value(state: PersistedAppState): Value {
  const workspace = state.workspaces[0],
    node = workspace.nodes.find(n => n.id === 'agent')!
  return {
    name: workspace.name,
    title: node.title,
    collapsed: workspace.collapsedNodeIds?.includes('agent') ?? false,
    sidebar: state.settings.sidebarCollapsedSpaceGroupIds['project:space'] === true,
    sidebarRoot: state.settings.sidebarCollapsedSpaceGroupIds['project:project-root'] === true,
    tuple: node.agent!.resumeSessionId!,
    runtime: node.sessionId ?? '',
  }
}
export function snapshot(template: PersistedAppState, model: Value): PersistedAppState {
  const state = structuredClone(template),
    workspace = state.workspaces[0],
    node = workspace.nodes.find(n => n.id === 'agent')!
  state.settings.sidebarCollapsedSpaceGroupIds = {
    ...(model.sidebar ? { 'project:space': true } : {}),
    ...(model.sidebarRoot ? { 'project:project-root': true } : {}),
  }
  workspace.name = model.name
  workspace.collapsedNodeIds = model.collapsed ? ['agent'] : []
  workspace.collapsedSpaceIds = []
  node.title = model.title
  node.sessionId = model.runtime
  node.agent!.resumeSessionId = model.tuple
  return state
}
