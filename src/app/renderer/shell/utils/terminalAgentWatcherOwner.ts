import type { ControlSurfaceInvokeRequest } from '@shared/contracts/controlSurface'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { resolveAgentTreatedProvider } from '@contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'

type ControlSurfaceInvoke = (request: ControlSurfaceInvokeRequest) => Promise<unknown>

interface OwnedWatcher {
  sessionId: string
}

export function createTerminalAgentWatcherOwner(options: {
  invoke: ControlSurfaceInvoke
  now?: () => number
}): {
  sync: (workspaces: WorkspaceState[]) => void
  dispose: () => void
} {
  const ownedBySessionId = new Map<string, OwnedWatcher>()
  const now = options.now ?? Date.now

  const detach = (sessionId: string): void => {
    ownedBySessionId.delete(sessionId)
    void options
      .invoke({
        kind: 'command',
        id: 'session.detachAgentStateWatcher',
        payload: { sessionId },
      })
      .catch(() => undefined)
  }

  const sync = (workspaces: WorkspaceState[]): void => {
    const desiredSessionIds = new Set<string>()

    for (const workspace of workspaces) {
      for (const node of workspace.nodes) {
        if (node.data.kind !== 'terminal') {
          continue
        }

        const binding = node.data.terminalAgentBinding ?? null
        const provider = resolveAgentTreatedProvider(node)
        const sessionId = node.data.sessionId.trim()
        if (!binding || !provider || sessionId.length === 0) {
          continue
        }

        desiredSessionIds.add(sessionId)
        if (ownedBySessionId.has(sessionId)) {
          continue
        }

        ownedBySessionId.set(sessionId, { sessionId })
        void options
          .invoke({
            kind: 'command',
            id: 'session.attachAgentStateWatcher',
            payload: {
              sessionId,
              provider,
              cwd: node.data.executionDirectory?.trim() || workspace.path,
              launchMode: binding.resumeSessionIdVerified === true ? 'resume' : 'new',
              resumeSessionId: binding.resumeSessionId,
              startedAtMs: node.data.agentOverlay?.startedAtMs ?? now(),
            },
          })
          .catch(() => {
            ownedBySessionId.delete(sessionId)
          })
      }
    }

    for (const sessionId of ownedBySessionId.keys()) {
      if (!desiredSessionIds.has(sessionId)) {
        detach(sessionId)
      }
    }
  }

  return {
    sync,
    dispose: () => {
      for (const sessionId of [...ownedBySessionId.keys()]) {
        detach(sessionId)
      }
    },
  }
}
