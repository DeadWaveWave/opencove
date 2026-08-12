import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData } from '../../../types'
import { resolveAgentTreatedActionContext } from '../../../utils/terminalAgentOverlay'
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
      const context = node ? resolveAgentTreatedActionContext(node) : null
      if (!context) {
        if (
          node?.data.kind === 'agent' &&
          node.data.agent &&
          (node.data.startedAt?.trim() ?? '').length === 0
        ) {
          onShowMessage?.(t('messages.agentLastMessageStartedAtMissing'), 'warning')
          return
        }
        onShowMessage?.(t('messages.agentLastMessageUnavailable'), 'warning')
        return
      }

      try {
        const message = await readLastAgentMessageWithRetry({
          provider: context.provider,
          cwd: context.cwd,
          startedAt: context.startedAt,
          resumeSessionId: context.resumeSessionId,
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
