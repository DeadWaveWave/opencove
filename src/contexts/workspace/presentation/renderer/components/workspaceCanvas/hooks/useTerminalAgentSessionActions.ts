import { useCallback, useRef, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { AgentSessionSummary, TerminalAgentActivityFence } from '@shared/contracts/dto'
import type { TerminalNodeData } from '../../../types'
import {
  reactivateTerminalAgentOverlayAfterReexec,
  resolveAgentTreatedActionContext,
} from '../../../utils/terminalAgentOverlay'
import type { ShowWorkspaceCanvasMessage } from '../types'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

function resolveActivityFence(node: Node<TerminalNodeData>): TerminalAgentActivityFence | null {
  if (node.data.kind !== 'terminal') {
    return null
  }
  const overlay = node.data.agentOverlay
  const activity = overlay?.activity
  if (
    !activity ||
    (overlay.provider !== 'claude-code' &&
      overlay.provider !== 'codex' &&
      overlay.provider !== 'pi')
  ) {
    return null
  }
  return {
    provider: overlay.provider,
    invocationId: activity.invocationId,
    generation: activity.generation,
    phase: activity.phase,
    observedAtMs: activity.observedAtMs,
    ...(activity.sourceRevision === undefined
      ? {}
      : { sourceRevision: activity.sourceRevision, revision: activity.revision }),
  }
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
  const reexecInFlight = useRef(new Set<string>())

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
      if (reexecInFlight.current.has(nodeId)) {
        return true
      }

      const sessionId = node.data.sessionId
      const expectedStartedAtMs = node.data.agentOverlay?.startedAtMs ?? 0
      const expectedActivity = resolveActivityFence(node)
      reexecInFlight.current.add(nodeId)
      try {
        const result = await window.opencoveApi.pty.reexecAgent({
          sessionId,
          provider: context.provider,
          resumeSessionId,
          expectedActivity,
        })
        if (result.status === 'drop_back_timeout') {
          onShowMessage?.(t('messages.terminalAgentReexecTimeout'), 'error')
          return true
        }
        if (result.status !== 'reexecuted') {
          onShowMessage?.(
            t('messages.terminalAgentReexecFailed', { message: t('common.unknownError') }),
            'error',
          )
          return true
        }

        let didChange = false
        setNodes(
          previousNodes =>
            previousNodes.map(candidate => {
              if (candidate.id !== nodeId || candidate.data.kind !== 'terminal') {
                return candidate
              }
              const next = reactivateTerminalAgentOverlayAfterReexec(candidate, {
                expectedSessionId: sessionId,
                expectedStartedAtMs,
                expectedActivity,
                provider: context.provider,
                startedAtMs,
                resumeSessionId,
                resumeSessionIdVerified,
              })
              didChange ||= next !== candidate
              return next
            }),
          { syncLayout: false },
        )
        if (didChange) {
          onRequestPersistFlush?.()
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('common.unknownError')
        onShowMessage?.(t('messages.terminalAgentReexecFailed', { message }), 'error')
      } finally {
        reexecInFlight.current.delete(nodeId)
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
