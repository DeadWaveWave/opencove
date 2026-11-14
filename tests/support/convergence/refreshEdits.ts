import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { Client } from './client'

/** Completed edits carry no active drag guard; refresh must preserve their intent itself. */
export function editRefreshNode(client: Client, deletion: boolean) {
  client.server.model.edit(
    deletion ? 'terminalPresent' : 'position',
    deletion ? false : '1234,5678',
  )
  useAppStore.setState(state => ({
    workspaces: (workspaces =>
      workspaces.map(workspace => ({
        ...workspace,
        nodes: deletion
          ? workspace.nodes.filter(node => node.id !== 'terminal')
          : workspace.nodes.map(node =>
              node.id === 'agent'
                ? { ...node, dragging: false, position: { x: 1234, y: 5678 } }
                : node,
            ),
        spaces: deletion
          ? workspace.spaces.map(space => ({
              ...space,
              nodeIds: space.nodeIds.filter(id => id !== 'terminal'),
            }))
          : workspace.spaces,
      })))(state.workspaces),
  }))
}
