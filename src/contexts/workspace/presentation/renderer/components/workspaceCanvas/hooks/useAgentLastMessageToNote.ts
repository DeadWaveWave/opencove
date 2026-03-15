import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { Point, TerminalNodeData } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { CreateNoteNodeOptions } from './useNodesStore.types'

export function useWorkspaceCanvasAgentLastMessageToNote({
  nodesRef,
  createNoteNode,
  updateNoteText,
  onRequestPersistFlush,
  onShowMessage,
}: {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  createNoteNode: (anchor: Point, options?: CreateNoteNodeOptions) => Node<TerminalNodeData> | null
  updateNoteText: (nodeId: string, text: string) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): (nodeId: string) => Promise<void> {
  const { t } = useTranslation()

  return useCallback(
    async (nodeId: string): Promise<void> => {
      const node = nodesRef.current.find(candidate => candidate.id === nodeId) ?? null
      if (!node || node.data.kind !== 'agent' || !node.data.agent) {
        onShowMessage?.(t('messages.agentLastMessageUnavailable'), 'warning')
        return
      }

      const startedAt = typeof node.data.startedAt === 'string' ? node.data.startedAt.trim() : ''
      if (startedAt.length === 0) {
        onShowMessage?.(t('messages.agentLastMessageStartedAtMissing'), 'warning')
        return
      }

      try {
        const result = await window.opencoveApi.agent.readLastMessage({
          provider: node.data.agent.provider,
          cwd: node.data.agent.executionDirectory,
          startedAt,
          resumeSessionId: node.data.agent.resumeSessionId ?? null,
        })

        const message = typeof result.message === 'string' ? result.message.trim() : ''
        if (message.length === 0) {
          onShowMessage?.(t('messages.agentLastMessageEmpty'), 'warning')
          return
        }

        const nextNote = createNoteNode(
          {
            x: node.position.x + node.data.width,
            y: node.position.y,
          },
          { placementStrategy: 'right-no-push' },
        )
        if (!nextNote) {
          return
        }

        updateNoteText(nextNote.id, message)
        onRequestPersistFlush?.()
        onShowMessage?.(t('messages.agentLastMessageSavedToNote'))
      } catch (error) {
        const detail =
          error instanceof Error && error.message ? error.message : t('common.unknownError')
        onShowMessage?.(t('messages.agentLastMessageReadFailed', { message: detail }), 'error')
      }
    },
    [createNoteNode, nodesRef, onRequestPersistFlush, onShowMessage, t, updateNoteText],
  )
}
