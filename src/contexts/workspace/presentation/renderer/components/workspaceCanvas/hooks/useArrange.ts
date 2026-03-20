import { useCallback } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import {
  arrangeWorkspaceAll,
  arrangeWorkspaceCanvas,
  arrangeWorkspaceInSpace,
  type WorkspaceArrangeStyle,
  type WorkspaceArrangeWarning,
} from '../../../utils/workspaceArrange'
import type { ShowWorkspaceCanvasMessage } from '../types'

const DEFAULT_VIEWPORT_WIDTH = 1440
const DEFAULT_VIEWPORT_MARGIN_PX = 96
const MIN_WRAP_WIDTH_PX = 720
const MAX_WRAP_WIDTH_PX = 3200

function resolveViewportSize(): { width: number; height: number } {
  const width =
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
      ? window.innerWidth
      : DEFAULT_VIEWPORT_WIDTH
  const height =
    typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0
      ? window.innerHeight
      : 900

  return { width: Math.round(width), height: Math.round(height) }
}

function resolveWrapWidth(reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>): number {
  const rawZoom = typeof reactFlow?.getZoom === 'function' ? reactFlow.getZoom() : 1
  const zoom = Number.isFinite(rawZoom) && rawZoom > 0 ? rawZoom : 1

  const viewportWidth =
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
      ? window.innerWidth
      : DEFAULT_VIEWPORT_WIDTH

  const flowWidth = viewportWidth / zoom
  const wrapWidth = flowWidth - DEFAULT_VIEWPORT_MARGIN_PX

  return Math.max(MIN_WRAP_WIDTH_PX, Math.min(MAX_WRAP_WIDTH_PX, Math.round(wrapWidth)))
}

function summarizeWarnings(warnings: WorkspaceArrangeWarning[]): { skippedSpaceCount: number } {
  const skippedSpaceIdSet = new Set(
    warnings.filter(warning => warning.kind === 'space_no_room').map(warning => warning.spaceId),
  )

  return {
    skippedSpaceCount: skippedSpaceIdSet.size,
  }
}

export function useWorkspaceCanvasArrange({
  reactFlow,
  nodesRef,
  spacesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): {
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
} {
  const { t } = useTranslation()

  const commitArrange = useCallback(
    (result: {
      nodes: Node<TerminalNodeData>[]
      spaces: WorkspaceSpaceState[]
      didChange: boolean
    }) => {
      if (!result.didChange) {
        return
      }

      setNodes(() => result.nodes, { syncLayout: false })

      if (result.spaces !== spacesRef.current) {
        spacesRef.current = result.spaces
        onSpacesChange(result.spaces)
      }

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, onSpacesChange, setNodes, spacesRef],
  )

  const arrangeAll = useCallback(
    (style?: WorkspaceArrangeStyle) => {
      const wrapWidth = resolveWrapWidth(reactFlow)
      const viewport = resolveViewportSize()
      const result = arrangeWorkspaceAll({
        nodes: nodesRef.current,
        spaces: spacesRef.current,
        wrapWidth,
        viewport,
        style,
      })

      commitArrange(result)

      const { skippedSpaceCount } = summarizeWarnings(result.warnings)
      if (skippedSpaceCount > 0) {
        onShowMessage?.(
          t('messages.arrangeAllSkippedSpaces', { count: skippedSpaceCount }),
          'warning',
        )
      }
    },
    [commitArrange, nodesRef, onShowMessage, reactFlow, spacesRef, t],
  )

  const arrangeCanvas = useCallback(
    (style?: WorkspaceArrangeStyle) => {
      const wrapWidth = resolveWrapWidth(reactFlow)
      const viewport = resolveViewportSize()
      const result = arrangeWorkspaceCanvas({
        nodes: nodesRef.current,
        spaces: spacesRef.current,
        wrapWidth,
        viewport,
        style,
      })

      commitArrange(result)
    },
    [commitArrange, nodesRef, reactFlow, spacesRef],
  )

  const arrangeInSpace = useCallback(
    (spaceId: string, style?: WorkspaceArrangeStyle) => {
      const viewport = resolveViewportSize()
      const result = arrangeWorkspaceInSpace({
        spaceId,
        nodes: nodesRef.current,
        spaces: spacesRef.current,
        viewport,
        style,
      })

      if (result.warnings.some(warning => warning.kind === 'space_no_room')) {
        onShowMessage?.(t('messages.arrangeSpaceNoRoom'), 'warning')
        return
      }

      commitArrange(result)
    },
    [commitArrange, nodesRef, onShowMessage, spacesRef, t],
  )

  return {
    arrangeAll,
    arrangeCanvas,
    arrangeInSpace,
  }
}
