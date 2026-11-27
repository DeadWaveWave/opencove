import { useCallback } from 'react'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'
import { resolveTerminalProviderHintFromCommand } from './useNodesStore.terminalProviderHint'
import { clearTerminalAgentOverlay, isAgentTreatedNode } from '../../../utils/terminalAgentOverlay'

export function useTerminalAgentOverlayMutations(): {
  updateTerminalTitle: UseWorkspaceCanvasNodesStoreResult['updateTerminalTitle']
  clearTerminalAgentOverlay: UseWorkspaceCanvasNodesStoreResult['clearTerminalAgentOverlay']
} {
  const { updateNodes } = useCanvasNodeWriter()
  const updateTerminalTitle = useCallback(
    (nodeId: string, title: string, _startedAtMs?: number) => {
      const normalizedTitle = title.trim()
      if (normalizedTitle.length === 0) {
        return
      }
      const provider = resolveTerminalProviderHintFromCommand(normalizedTitle)

      updateNodes(
        previousNodes => {
          let didChange = false
          const nextNodes = previousNodes.map(node => {
            if (node.id !== nodeId || node.data.kind !== 'terminal' || isAgentTreatedNode(node)) {
              return node
            }

            const nextTitle =
              node.data.titlePinnedByUser === true ? node.data.title : normalizedTitle
            const nextProviderHint = provider ?? node.data.terminalProviderHint ?? null
            const titleOrHintChanged =
              node.data.title !== nextTitle ||
              (node.data.terminalProviderHint ?? null) !== nextProviderHint
            const titledNode = titleOrHintChanged
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    title: nextTitle,
                    terminalProviderHint: nextProviderHint,
                  },
                }
              : node
            const nextNode = titledNode
            if (nextNode === node) {
              return node
            }

            didChange = true
            return nextNode
          })
          return didChange ? nextNodes : previousNodes
        },
        { syncLayout: false },
      )
    },
    [updateNodes],
  )

  const clearOverlay = useCallback(
    (nodeId: string, expectedStartedAtMs?: number) => {
      updateNodes(
        previousNodes => {
          let didChange = false
          const nextNodes = previousNodes.map(node => {
            if (node.id !== nodeId) {
              return node
            }
            const nextNode = clearTerminalAgentOverlay(node, { expectedStartedAtMs })
            didChange ||= nextNode !== node
            return nextNode
          })
          return didChange ? nextNodes : previousNodes
        },
        { syncLayout: false },
      )
    },
    [updateNodes],
  )

  return { updateTerminalTitle, clearTerminalAgentOverlay: clearOverlay }
}
