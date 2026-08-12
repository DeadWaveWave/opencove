import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentSessionSummary } from '@shared/contracts/dto'
import type { TerminalNodeData } from '../../../types'
import {
  isAgentTreatedNode,
  reactivateTerminalAgentOverlayAfterReexec,
  resolveAgentTreatedActionContext,
} from '../../../utils/terminalAgentOverlay'
import {
  buildTerminalAgentReentryCommand,
  reexecTerminalAgentInPty,
} from '../../../utils/terminalAgentPtyReexec'
import type { ShowWorkspaceCanvasMessage } from '../types'

const DROP_BACK_TIMEOUT_MS = 3_000
const DROP_BACK_POLL_MS = 20

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

async function waitForDropBack(options: {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  nodeId: string
  sessionId: string
}): Promise<boolean> {
  const deadline = Date.now() + DROP_BACK_TIMEOUT_MS
  while (Date.now() < deadline) {
    const current = options.nodesRef.current.find(node => node.id === options.nodeId)
    if (
      current?.data.kind === 'terminal' &&
      current.data.sessionId === options.sessionId &&
      !isAgentTreatedNode(current)
    ) {
      return true
    }
    // eslint-disable-next-line no-await-in-loop -- bounded polling observes asynchronous drop-back
    await new Promise(resolve => window.setTimeout(resolve, DROP_BACK_POLL_MS))
  }
  return false
}

export function useTerminalAgentSessionActions(options: {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): {
  reloadOverlayAgent: (nodeId: string) => Promise<boolean>
  listOverlayAgentSessions: (
    nodeId: string,
    limit?: number,
  ) => Promise<AgentSessionSummary[] | null>
  switchOverlayAgentSession: (nodeId: string, summary: AgentSessionSummary) => Promise<boolean>
} {
  const { t } = useTranslation()
  const { nodesRef, onRequestPersistFlush, onShowMessage, setNodes } = options

  const reexecOverlayAgent = useCallback(
    async ({
      nodeId,
      resumeSessionId,
      resumeSessionIdVerified,
      startedAtMs,
    }: {
      nodeId: string
      resumeSessionId: string | null
      resumeSessionIdVerified: boolean
      startedAtMs: number
    }): Promise<boolean> => {
      const node = nodesRef.current.find(candidate => candidate.id === nodeId)
      const context = node ? resolveAgentTreatedActionContext(node) : null
      if (!node || node.data.kind !== 'terminal' || !context) {
        return false
      }

      const sessionId = node.data.sessionId
      try {
        const result = await reexecTerminalAgentInPty({
          sessionId,
          command: buildTerminalAgentReentryCommand({
            provider: context.provider,
            resumeSessionId,
          }),
          write: async input => await window.opencoveApi.pty.write(input),
          waitForDropBack: async () =>
            await waitForDropBack({
              nodesRef,
              nodeId,
              sessionId,
            }),
        })

        if (result === 'drop-back-timeout') {
          onShowMessage?.(t('messages.terminalAgentReexecTimeout'), 'error')
          return true
        }

        setNodes(
          previousNodes =>
            previousNodes.map(candidate => {
              if (
                candidate.id !== nodeId ||
                candidate.data.kind !== 'terminal' ||
                candidate.data.sessionId !== sessionId ||
                isAgentTreatedNode(candidate)
              ) {
                return candidate
              }

              return reactivateTerminalAgentOverlayAfterReexec(candidate, {
                expectedSessionId: sessionId,
                provider: context.provider,
                startedAtMs,
                resumeSessionId,
                resumeSessionIdVerified,
              })
            }),
          { syncLayout: false },
        )
        onRequestPersistFlush?.()
      } catch (error) {
        const message = error instanceof Error ? error.message : t('common.unknownError')
        onShowMessage?.(t('messages.terminalAgentReexecFailed', { message }), 'error')
      }
      return true
    },
    [nodesRef, onRequestPersistFlush, onShowMessage, setNodes, t],
  )

  const reloadOverlayAgent = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const node = nodesRef.current.find(candidate => candidate.id === nodeId)
      const context = node ? resolveAgentTreatedActionContext(node) : null
      if (!node || node.data.kind !== 'terminal' || !context) {
        return false
      }

      const canResume = context.resumeSessionIdVerified && Boolean(context.resumeSessionId)
      return await reexecOverlayAgent({
        nodeId,
        resumeSessionId: canResume ? context.resumeSessionId : null,
        resumeSessionIdVerified: canResume,
        startedAtMs: canResume ? node.data.agentOverlay!.startedAtMs : Date.now(),
      })
    },
    [nodesRef, reexecOverlayAgent],
  )

  const listOverlayAgentSessions = useCallback(
    async (nodeId: string, limit = 20): Promise<AgentSessionSummary[] | null> => {
      const node = nodesRef.current.find(candidate => candidate.id === nodeId)
      const context = node ? resolveAgentTreatedActionContext(node) : null
      if (!node || node.data.kind !== 'terminal' || !context) {
        return null
      }

      const result = await window.opencoveApi.agent.listSessions({
        provider: context.provider,
        cwd: context.cwd,
        limit,
      })
      return result.sessions
    },
    [nodesRef],
  )

  const switchOverlayAgentSession = useCallback(
    async (nodeId: string, summary: AgentSessionSummary): Promise<boolean> => {
      const node = nodesRef.current.find(candidate => candidate.id === nodeId)
      const context = node ? resolveAgentTreatedActionContext(node) : null
      if (!node || node.data.kind !== 'terminal' || !context) {
        return false
      }
      if (summary.provider !== context.provider) {
        return true
      }
      if (context.resumeSessionIdVerified && context.resumeSessionId === summary.sessionId) {
        return true
      }

      const summaryStartedAtMs = summary.startedAt ? Date.parse(summary.startedAt) : Number.NaN
      return await reexecOverlayAgent({
        nodeId,
        resumeSessionId: summary.sessionId,
        resumeSessionIdVerified: true,
        startedAtMs: Number.isFinite(summaryStartedAtMs) ? summaryStartedAtMs : Date.now(),
      })
    },
    [nodesRef, reexecOverlayAgent],
  )

  return { reloadOverlayAgent, listOverlayAgentSessions, switchOverlayAgentSession }
}
