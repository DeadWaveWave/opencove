import { useEffect, useRef, type RefObject } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { useReadCanvasDocument, useReadCanvasSelection } from '../../../store/canvasStoreContext'

export function useCloseSelectedNodeShortcut({
  enabled,
  canvasRef,
  closeNode,
  onShowMessage,
}: {
  enabled: boolean
  canvasRef: RefObject<HTMLDivElement | null>
  closeNode: (nodeId: string) => Promise<void>
  onShowMessage?: (message: string, level: 'info' | 'warning' | 'error') => void
}): void {
  const { t } = useTranslation()
  const readDocument = useReadCanvasDocument()
  const readSelection = useReadCanvasSelection()
  const closing = useRef(new Set<string>())
  useEffect(() => {
    if (!enabled) {
      return
    }
    let active = true
    const unsubscribe = window.opencoveApi?.lifecycle?.onApplicationShortcut?.(event => {
      if (event !== 'close-selected-node') {
        return
      }
      const selected = readSelection().nodeIds
      const focusedElement = document.activeElement?.closest('.react-flow__node')
      const focusedId = canvasRef.current?.contains(focusedElement ?? null)
        ? focusedElement?.getAttribute('data-id')
        : null
      // Terminal/editor input focus is independent of canvas multiselection.
      const nodeId = focusedId ?? (selected.length === 1 ? selected[0] : null)
      if (!nodeId) {
        if (selected.length > 1) {
          onShowMessage?.(t('common.closeShortcutSelectWindow'), 'warning')
        }
        return
      }
      const node = readDocument().nodes.find(item => item.id === nodeId && !item.hidden)
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
  }, [enabled, canvasRef, readDocument, readSelection, closeNode, onShowMessage, t])
}
