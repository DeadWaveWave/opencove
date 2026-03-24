import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'

const AGENT_LAST_MESSAGE_READ_MAX_ATTEMPTS = 5
const AGENT_LAST_MESSAGE_READ_RETRY_MS = 220

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => {
    window.setTimeout(resolve, ms)
  })
}

async function readLastAgentMessageWithRetry(
  payload: Parameters<typeof window.opencoveApi.agent.readLastMessage>[0],
): Promise<string> {
  return await readLastAgentMessageWithRetryAttempt(payload, 0)
}

async function readLastAgentMessageWithRetryAttempt(
  payload: Parameters<typeof window.opencoveApi.agent.readLastMessage>[0],
  attempt: number,
): Promise<string> {
  const result = await window.opencoveApi.agent.readLastMessage(payload)
  const message = typeof result.message === 'string' ? result.message.trim() : ''
  if (message.length > 0) {
    return message
  }

  if (attempt >= AGENT_LAST_MESSAGE_READ_MAX_ATTEMPTS - 1) {
    return ''
  }

  await delay(AGENT_LAST_MESSAGE_READ_RETRY_MS)
  return await readLastAgentMessageWithRetryAttempt(payload, attempt + 1)
}

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
        const message = await readLastAgentMessageWithRetry({
          provider: node.data.agent.provider,
          cwd: node.data.agent.executionDirectory,
          startedAt,
          resumeSessionId: node.data.agent.resumeSessionId ?? null,
        })

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
