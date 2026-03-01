import { useEffect } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'

export function useWorkspaceCanvasPtyTaskCompletion({
  setNodes,
}: {
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
}): void {
  useEffect(() => {
    const ptyWithOptionalState = window.coveApi.pty as typeof window.coveApi.pty & {
      onState?:
        | ((
            listener: (event: { sessionId: string; state: 'working' | 'standby' }) => void,
          ) => () => void)
        | undefined
    }

    const unsubscribeState =
      typeof ptyWithOptionalState.onState === 'function'
        ? ptyWithOptionalState.onState(event => {
            setNodes(prevNodes =>
              prevNodes.map(node => {
                if (node.data.kind !== 'agent' || node.data.sessionId !== event.sessionId) {
                  return node
                }

                if (
                  node.data.status === 'failed' ||
                  node.data.status === 'stopped' ||
                  node.data.status === 'exited'
                ) {
                  return node
                }

                const nextStatus = event.state === 'standby' ? 'standby' : 'running'
                if (node.data.status === nextStatus) {
                  return node
                }

                return {
                  ...node,
                  data: {
                    ...node.data,
                    status: nextStatus,
                  },
                }
              }),
            )
          })
        : () => undefined

    const unsubscribeExit = window.coveApi.pty.onExit(event => {
      setNodes(prevNodes => {
        let relatedTaskNodeId: string | null = null

        const nextNodes = prevNodes.map(node => {
          if (node.data.sessionId !== event.sessionId || node.data.kind !== 'agent') {
            return node
          }

          if (node.data.status === 'stopped') {
            return node
          }

          relatedTaskNodeId = node.data.agent?.taskId ?? null

          return {
            ...node,
            data: {
              ...node.data,
              status: event.exitCode === 0 ? ('exited' as const) : ('failed' as const),
              endedAt: new Date().toISOString(),
              exitCode: event.exitCode,
            },
          }
        })

        if (event.exitCode !== 0 || !relatedTaskNodeId) {
          return nextNodes
        }

        return nextNodes.map(node => {
          if (node.id !== relatedTaskNodeId || node.data.kind !== 'task' || !node.data.task) {
            return node
          }

          return {
            ...node,
            data: {
              ...node.data,
              task: {
                ...node.data.task,
                status: 'ai_done',
                updatedAt: new Date().toISOString(),
              },
            },
          }
        })
      })
    })

    return () => {
      unsubscribeState()
      unsubscribeExit()
    }
  }, [setNodes])
}
