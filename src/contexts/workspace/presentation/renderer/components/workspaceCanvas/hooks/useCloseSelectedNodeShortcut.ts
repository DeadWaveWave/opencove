import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { useTranslation } from '@app/renderer/i18n'

export function useCloseSelectedNodeShortcut({
  enabled,
  canvasRef,
  nodesRef,
  selectedNodeIdsRef,
  closeNode,
  onShowMessage,
}: {
  enabled: boolean
  canvasRef: RefObject<HTMLDivElement | null>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  selectedNodeIdsRef: MutableRefObject<string[]>
  closeNode: (nodeId: string) => Promise<void>
  onShowMessage?: (message: string, level: 'info' | 'warning' | 'error') => void
}): void {
  const { t } = useTranslation()
  const closing = useRef(new Set<string>())
  useEffect(() => {
    if (!enabled) {
      return
    }
    let active = true
    const unsubscribe = window.opencoveApi?.lifecycle?.onApplicationShortcut?.(event => {
      if (event !== 'close-selected-node' || selectedNodeIdsRef.current.length === 0) {
        return
      }
      const selected = selectedNodeIdsRef.current
      const focusedElement = document.activeElement?.closest('.react-flow__node')
      const focusedId = canvasRef.current?.contains(focusedElement ?? null)
        ? focusedElement?.getAttribute('data-id')
        : null
      const nodeId =
        selected.length === 1
          ? selected[0]
          : focusedId && selected.includes(focusedId)
            ? focusedId
            : null
      if (!nodeId) {
        onShowMessage?.(t('common.closeShortcutSelectWindow'), 'warning')
        return
      }
      const node = nodesRef.current.find(item => item.id === nodeId && !item.hidden)
      if (!node || closing.current.has(nodeId)) {
        return
      }
      if (node.data.kind === 'document') {
        // The document owns save-before-close and conflict handling, including pending saves.
        const element = Array.from(
          canvasRef.current?.querySelectorAll('.react-flow__node') ?? [],
        ).find(item => item.getAttribute('data-id') === nodeId)
        element?.querySelector<HTMLButtonElement>('.document-node__close')?.click()
        return
      }
      const pending = closing.current
      pending.add(nodeId)
      void closeNode(nodeId)
        .catch(() => {
          if (active) {
            onShowMessage?.(t('common.closeShortcutFailed'), 'error')
          }
        })
        .finally(() => pending.delete(nodeId))
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [enabled, canvasRef, nodesRef, selectedNodeIdsRef, closeNode, onShowMessage, t])
}
