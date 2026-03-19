import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'

export function useWorkspaceCanvasAgentLastMessageCopy({
  nodesRef,
  onShowMessage,
}: {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
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

        if (typeof window.opencoveApi?.clipboard?.writeText !== 'function') {
          throw new Error(t('common.unknownError'))
        }

        await window.opencoveApi.clipboard.writeText(message)
        onShowMessage?.(t('messages.agentLastMessageCopied'))
      } catch (error) {
        const detail =
          error instanceof Error && error.message ? error.message : t('common.unknownError')
        onShowMessage?.(t('messages.agentLastMessageCopyFailed', { message: detail }), 'error')
      }
    },
    [nodesRef, onShowMessage, t],
  )
}
