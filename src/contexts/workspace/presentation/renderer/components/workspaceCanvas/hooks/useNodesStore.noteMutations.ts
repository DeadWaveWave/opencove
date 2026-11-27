import { useCallback } from 'react'
import { useCanvasDocumentCommands } from '../../../store/canvasStoreContext'
import { guardNodeFromSyncOverwrite } from '../../../utils/syncNodeGuards'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'

export function useWorkspaceCanvasNoteNodeMutations(): Pick<
  UseWorkspaceCanvasNodesStoreResult,
  'updateNoteText' | 'renameNoteTitle'
> {
  const { requestPersistFlush } = useCanvasDocumentCommands()
  const { updateNodes } = useCanvasNodeWriter()
  const updateNoteText = useCallback(
    (nodeId: string, text: string) => {
      const normalizedNodeId = nodeId.trim()
      if (normalizedNodeId.length === 0) {
        return
      }

      guardNodeFromSyncOverwrite(normalizedNodeId)
      updateNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== normalizedNodeId || node.data.kind !== 'note' || !node.data.note) {
              return node
            }

            if (node.data.note.text === text) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                note: {
                  ...node.data.note,
                  text,
                },
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )
    },
    [updateNodes],
  )

  const renameNoteTitle = useCallback(
    (nodeId: string, title: string) => {
      const normalizedNodeId = nodeId.trim()
      if (normalizedNodeId.length === 0) {
        return
      }

      const normalizedTitle = title.trim()
      guardNodeFromSyncOverwrite(normalizedNodeId)
      let didChange = false

      updateNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== normalizedNodeId || node.data.kind !== 'note') {
              return node
            }

            const isPinned = node.data.titlePinnedByUser === true
            if (node.data.title === normalizedTitle && isPinned) {
              return node
            }

            hasChanged = true
            didChange = true
            return {
              ...node,
              data: {
                ...node.data,
                title: normalizedTitle,
                titlePinnedByUser: true,
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      // The write decides whether there is anything to persist.
      if (didChange) {
        requestPersistFlush()
      }
    },
    [requestPersistFlush, updateNodes],
  )

  return { updateNoteText, renameNoteTitle }
}
