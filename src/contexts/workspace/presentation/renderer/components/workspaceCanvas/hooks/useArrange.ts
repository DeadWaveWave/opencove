import { useCallback, useLayoutEffect } from 'react'
import {
  getViewportForBounds,
  useStore,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  FocusNodeTargetZoom,
  StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../types'
import { useCanvasDocumentCommands, useReadCanvasDocument } from '../../../store/canvasStoreContext'
import {
  arrangeWorkspaceAll,
  arrangeWorkspaceCanvas,
  arrangeWorkspaceInSpace,
  type WorkspaceArrangeResult,
  type WorkspaceArrangeStyle,
  type WorkspaceArrangeWarning,
} from '../../../utils/workspaceArrange'
import { resolveWorkspaceCanvasAnimationDuration } from '../helpers'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { bindWorkspaceCanvasArrangeInSpaceTestAction } from '../testHarness'

const DEFAULT_VIEWPORT_WIDTH = 1440
const DEFAULT_VIEWPORT_HEIGHT = 900
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
      : DEFAULT_VIEWPORT_HEIGHT

  return { width: Math.round(width), height: Math.round(height) }
}

export function resolveArrangeWrapWidth(viewport: { width: number; height: number }): number {
  const defaultAspect = DEFAULT_VIEWPORT_WIDTH / DEFAULT_VIEWPORT_HEIGHT
  const aspect =
    viewport.height > 0 && Number.isFinite(viewport.width / viewport.height)
      ? viewport.width / viewport.height
      : defaultAspect
  const wrapWidth = (DEFAULT_VIEWPORT_WIDTH - DEFAULT_VIEWPORT_MARGIN_PX) * (aspect / defaultAspect)

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
  focusNodeTargetZoom,
  updateCanvasDocument,
  onShowMessage,
  standardWindowSizeBucket,
}: {
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  focusNodeTargetZoom: FocusNodeTargetZoom
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
  onShowMessage?: ShowWorkspaceCanvasMessage
  standardWindowSizeBucket: StandardWindowSizeBucket
}): {
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
} {
  const { t } = useTranslation()
  const readDocument = useReadCanvasDocument()
  const { requestPersistFlush } = useCanvasDocumentCommands()
  const viewportWidth = useStore(state => state.width)
  const viewportHeight = useStore(state => state.height)
  const viewportMinZoom = useStore(state => state.minZoom)
  const viewportMaxZoom = useStore(state => state.maxZoom)

  // Plans from the nodes and the Spaces of the document when the write runs, and writes the nodes
  // and the Spaces together. A layout that changes nothing is neither written nor flushed, and
  // does not move the viewport. Returns the layout, for the warnings.
  const commitArrange = useCallback(
    (
      plan: (input: Pick<WorkspaceArrangeResult, 'nodes' | 'spaces'>) => WorkspaceArrangeResult,
      options?: { focusSpaceId?: string },
    ): WorkspaceArrangeResult | null => {
      const outcome: { result: WorkspaceArrangeResult | null } = { result: null }
      updateCanvasDocument(
        ({ nodes, spaces }) => {
          const planned = plan({ nodes, spaces })
          outcome.result = planned
          return planned.didChange
            ? { nodes: planned.nodes, spaces: planned.spaces }
            : { nodes, spaces }
        },
        { syncLayout: false },
      )

      const { result } = outcome
      if (!result?.didChange) {
        return result
      }

      requestPersistFlush()

      const schedule =
        typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)

      schedule(() => {
        const document = readDocument()
        if (options?.focusSpaceId) {
          const space = document.spaces.find(item => item.id === options.focusSpaceId) ?? null
          if (!space?.rect) {
            return
          }

          const width = viewportWidth > 0 ? viewportWidth : DEFAULT_VIEWPORT_WIDTH
          const height = viewportHeight > 0 ? viewportHeight : DEFAULT_VIEWPORT_HEIGHT
          const maxZoom = Math.max(viewportMinZoom, Math.min(viewportMaxZoom, focusNodeTargetZoom))
          const viewport = getViewportForBounds(
            space.rect,
            width,
            height,
            viewportMinZoom,
            maxZoom,
            0.16,
          )

          void reactFlow.setViewport(viewport, {
            duration: resolveWorkspaceCanvasAnimationDuration(220),
          })
          return
        }

        if (document.nodes.length > 0) {
          void reactFlow.fitView({
            padding: 0.16,
            duration: resolveWorkspaceCanvasAnimationDuration(220),
          })
        }
      })

      return result
    },
    [
      focusNodeTargetZoom,
      readDocument,
      reactFlow,
      requestPersistFlush,
      updateCanvasDocument,
      viewportHeight,
      viewportMaxZoom,
      viewportMinZoom,
      viewportWidth,
    ],
  )

  const arrangeAll = useCallback(
    (style?: WorkspaceArrangeStyle) => {
      const viewport = resolveViewportSize()
      const wrapWidth = resolveArrangeWrapWidth(viewport)
      const result = commitArrange(({ nodes, spaces }) =>
        arrangeWorkspaceAll({
          nodes,
          spaces,
          wrapWidth,
          viewport,
          standardWindowSizeBucket,
          style,
        }),
      )

      const { skippedSpaceCount } = summarizeWarnings(result?.warnings ?? [])
      if (skippedSpaceCount > 0) {
        onShowMessage?.(
          t('messages.arrangeAllSkippedSpaces', { count: skippedSpaceCount }),
          'warning',
        )
      }
    },
    [commitArrange, onShowMessage, standardWindowSizeBucket, t],
  )

  const arrangeCanvas = useCallback(
    (style?: WorkspaceArrangeStyle) => {
      const viewport = resolveViewportSize()
      const wrapWidth = resolveArrangeWrapWidth(viewport)
      commitArrange(({ nodes, spaces }) =>
        arrangeWorkspaceCanvas({
          nodes,
          spaces,
          wrapWidth,
          viewport,
          standardWindowSizeBucket,
          style,
        }),
      )
    },
    [commitArrange, standardWindowSizeBucket],
  )

  const arrangeInSpace = useCallback(
    (spaceId: string, style?: WorkspaceArrangeStyle) => {
      const viewport = resolveViewportSize()
      const result = commitArrange(
        ({ nodes, spaces }) =>
          arrangeWorkspaceInSpace({
            spaceId,
            nodes,
            spaces,
            viewport,
            standardWindowSizeBucket,
            style,
          }),
        { focusSpaceId: spaceId },
      )

      if (result?.warnings.some(warning => warning.kind === 'space_no_room')) {
        onShowMessage?.(t('messages.arrangeSpaceNoRoom'), 'warning')
      }
    },
    [commitArrange, onShowMessage, standardWindowSizeBucket, t],
  )

  useLayoutEffect(() => {
    if (window.opencoveApi?.meta?.isTest !== true) {
      return
    }

    bindWorkspaceCanvasArrangeInSpaceTestAction(arrangeInSpace)
    return () => {
      bindWorkspaceCanvasArrangeInSpaceTestAction(null)
    }
  }, [arrangeInSpace])

  return {
    arrangeAll,
    arrangeCanvas,
    arrangeInSpace,
  }
}
