import { useCallback } from 'react'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { resolveTerminalProviderHintFromCommand } from './useNodesStore.terminalProviderHint'
import {
  activateTerminalAgentOverlay,
  clearTerminalAgentOverlay,
  isAgentTreatedNode,
} from '../../../utils/terminalAgentOverlay'

type SetNodes = UseWorkspaceCanvasNodesStoreResult['setNodes']

export function useTerminalAgentOverlayMutations(setNodes: SetNodes): {
  updateTerminalTitle: UseWorkspaceCanvasNodesStoreResult['updateTerminalTitle']
  clearTerminalAgentOverlay: UseWorkspaceCanvasNodesStoreResult['clearTerminalAgentOverlay']
} {
  const updateTerminalTitle = useCallback(
    (nodeId: string, title: string) => {
      const normalizedTitle = title.trim()
      if (normalizedTitle.length === 0) {
        return
      }
      const provider = resolveTerminalProviderHintFromCommand(normalizedTitle)

      setNodes(
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
            const nextNode = provider
              ? activateTerminalAgentOverlay(titledNode, {
                  provider,
                  startedAtMs: Date.now(),
                })
              : titledNode
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
    [setNodes],
  )

  const clearOverlay = useCallback(
    (nodeId: string) => {
      setNodes(
        previousNodes => {
          let didChange = false
          const nextNodes = previousNodes.map(node => {
            if (node.id !== nodeId) {
              return node
            }
            const nextNode = clearTerminalAgentOverlay(node)
            didChange ||= nextNode !== node
            return nextNode
          })
          return didChange ? nextNodes : previousNodes
        },
        { syncLayout: false },
      )
    },
    [setNodes],
  )

  return { updateTerminalTitle, clearTerminalAgentOverlay: clearOverlay }
}
