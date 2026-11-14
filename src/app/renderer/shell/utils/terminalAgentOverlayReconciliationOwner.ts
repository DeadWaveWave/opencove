import type { TerminalForegroundEvent } from '@shared/contracts/dto'
import { resolveForegroundAgentReconciliation } from '@shared/runtime/agentForegroundRecognition'
import { isResumeSessionBindingVerified } from '@contexts/agent/domain/agentResumeBinding'
import { applyRuntimeObservation } from '@contexts/workspace/presentation/renderer'
import { clearTerminalAgentOverlay } from '@contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'

export function createTerminalAgentOverlayReconciliationOwner(options: {
  source: {
    onForeground: (listener: (event: TerminalForegroundEvent) => void) => () => void
  }
}): { dispose: () => void } {
  let disposed = false

  const unsubscribe = options.source.onForeground(event => {
    if (disposed || resolveForegroundAgentReconciliation(event) !== 'clear') {
      return
    }

    applyRuntimeObservation(workspaces => {
      let didChange = false
      const nextWorkspaces = workspaces.map(workspace => {
        let workspaceDidChange = false
        const nextNodes = workspace.nodes.map(node => {
          const overlay = node.data.kind === 'terminal' ? node.data.agentOverlay : null
          if (
            node.data.kind !== 'terminal' ||
            node.data.sessionId !== event.sessionId ||
            overlay?.provider !== 'codex' ||
            Boolean(overlay.activity) ||
            (node.data.terminalAgentBinding
              ? isResumeSessionBindingVerified(node.data.terminalAgentBinding)
              : false) ||
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

      return { nextWorkspaces, didChange, durableDidChange: didChange }
    })
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
