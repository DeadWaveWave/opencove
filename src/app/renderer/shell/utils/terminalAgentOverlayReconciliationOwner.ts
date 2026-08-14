import type { TerminalForegroundEvent } from '@shared/contracts/dto'
import { resolveForegroundAgentReconciliation } from '@shared/runtime/agentForegroundRecognition'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { clearTerminalAgentOverlay } from '@contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'

type SetWorkspaces = (updater: (previous: WorkspaceState[]) => WorkspaceState[]) => void

export function createTerminalAgentOverlayReconciliationOwner(options: {
  source: {
    onForeground: (listener: (event: TerminalForegroundEvent) => void) => () => void
  }
  setWorkspaces: SetWorkspaces
  requestPersistFlush: () => void
}): { dispose: () => void } {
  let disposed = false

  const unsubscribe = options.source.onForeground(event => {
    if (disposed || resolveForegroundAgentReconciliation(event) !== 'clear') {
      return
    }

    let didChange = false
    options.setWorkspaces(previous => {
      const nextWorkspaces = previous.map(workspace => {
        let workspaceDidChange = false
        const nextNodes = workspace.nodes.map(node => {
          const overlay = node.data.kind === 'terminal' ? node.data.agentOverlay : null
          if (
            node.data.kind !== 'terminal' ||
            node.data.sessionId !== event.sessionId ||
            overlay?.provider !== 'codex' ||
            event.observedAtMs < overlay.startedAtMs
          ) {
            return node
          }

          // The observed timestamp rejects delayed evidence from an older command, while the
          // expected generation protects against a concurrent overlay replacement in this update.
          const cleared = clearTerminalAgentOverlay(node, {
            expectedStartedAtMs: overlay.startedAtMs,
          })
          workspaceDidChange ||= cleared !== node
          return cleared
        })

        if (!workspaceDidChange) {
          return workspace
        }
        didChange = true
        return { ...workspace, nodes: nextNodes }
      })

      return didChange ? nextWorkspaces : previous
    })

    if (didChange) {
      options.requestPersistFlush()
    }
  })

  return {
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      unsubscribe()
    },
  }
}
