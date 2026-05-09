import React from 'react'
import { useStore } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { ResolveMountTargetResult } from '@shared/contracts/dto'
import type { ShowWorkspaceCanvasMessage, WorkspaceCanvasProps } from '../types'
import type { SpaceExplorerOpenDocumentBlock } from '../hooks/useSpaceExplorer.guards'
import { toErrorMessage } from '../helpers'
import { selectViewportTransform } from './WorkspaceSpaceExplorerOverlay.helpers'
import {
  resolveExplorerAutoPreferredWidth,
  resolveExplorerDefaultOffset,
  resolveExplorerWindowPlacement,
  type SpaceExplorerWindowOffset,
  type SpaceExplorerViewportBounds,
} from './WorkspaceSpaceExplorerOverlay.layout'
import type { SpaceExplorerClipboardItem } from './WorkspaceSpaceExplorerOverlay.operations'
import { WorkspaceSpaceExplorerOverlayBody } from './WorkspaceSpaceExplorerOverlayBody'

export function WorkspaceSpaceExplorerOverlay({
  spaceId,
  spaceName,
  targetMountId,
  directoryPath,
  rect,
  agentSettings,
  explorerClipboard,
  setExplorerClipboard,
  findBlockingOpenDocument,
  onShowMessage,
  onClose,
  onPreviewFile,
  onOpenFile,
  onDismissQuickPreview,
}: {
  spaceId: string
  spaceName: string
  targetMountId: string | null
  directoryPath: string
  rect: { x: number; y: number; width: number; height: number }
  agentSettings: WorkspaceCanvasProps['agentSettings']
  explorerClipboard: SpaceExplorerClipboardItem | null
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
  onShowMessage?: ShowWorkspaceCanvasMessage
  onClose: () => void
  onPreviewFile: (
    uri: string,
    options?: {
      explorerPlacementPx?: { left: number; top: number; width: number; height: number }
    },
  ) => void
  onOpenFile: (
    uri: string,
    options?: {
      explorerPlacementPx?: { left: number; top: number; width: number; height: number }
    },
  ) => void
  onDismissQuickPreview: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [translateX, translateY, zoom] = useStore(selectViewportTransform)
  const viewportWidth = useStore(state => state.width)
  const viewportHeight = useStore(state => state.height)
  const viewportZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const containerRef = React.useRef<HTMLElement | null>(null)
  const createInputRef = React.useRef<HTMLInputElement | null>(null)
  const renameInputRef = React.useRef<HTMLInputElement | null>(null)
  const resizeStartRef = React.useRef<{
    startX: number
    startWidth: number
    minWidth: number
    maxWidth: number
    zoom: number
  } | null>(null)
  const dragStartRef = React.useRef<{
    startX: number
    startY: number
    startOffset: SpaceExplorerWindowOffset
    zoom: number
  } | null>(null)
  const resizeCleanupRef = React.useRef<(() => void) | null>(null)
  const dragCleanupRef = React.useRef<(() => void) | null>(null)
  const [manualWidth, setManualWidth] = React.useState<number | null>(null)
  const [manualOffset, setManualOffset] = React.useState<SpaceExplorerWindowOffset | null>(null)

  const trimmedDirectoryPath = directoryPath.trim()
  const directoryRootUri = React.useMemo(
    () => (trimmedDirectoryPath.length > 0 ? toFileUri(trimmedDirectoryPath) : null),
    [trimmedDirectoryPath],
  )
  const [resolvedMountRootUri, setResolvedMountRootUri] = React.useState<string | null>(null)
  const [rootResolveError, setRootResolveError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setManualWidth(null)
    setManualOffset(null)
  }, [spaceId])

  React.useEffect(() => {
    setResolvedMountRootUri(null)
    setRootResolveError(null)

    if (!targetMountId || directoryRootUri) {
      return
    }

    const controlSurfaceInvoke = (
      window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
    ).opencoveApi?.controlSurface?.invoke

    if (typeof controlSurfaceInvoke !== 'function') {
      setResolvedMountRootUri(null)
      setRootResolveError(t('documentNode.filesystemUnavailable'))
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const result = await window.opencoveApi.controlSurface.invoke<ResolveMountTargetResult>({
          kind: 'query',
          id: 'mountTarget.resolve',
          payload: { mountId: targetMountId },
        })

        if (cancelled) {
          return
        }

        if (!result) {
          setResolvedMountRootUri(null)
          setRootResolveError(t('documentNode.filesystemUnavailable'))
          return
        }

        setResolvedMountRootUri(result.rootUri)
      } catch (error) {
        if (cancelled) {
          return
        }

        setResolvedMountRootUri(null)
        setRootResolveError(toErrorMessage(error))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [directoryRootUri, t, targetMountId])

  const isResolvingMountRoot =
    !!targetMountId &&
    !directoryRootUri &&
    resolvedMountRootUri === null &&
    rootResolveError === null
  const rootUri = isResolvingMountRoot ? null : (directoryRootUri ?? resolvedMountRootUri)
  const mountIdForFilesystem = targetMountId
  const viewportBounds = React.useMemo<SpaceExplorerViewportBounds | null>(() => {
    if (
      !Number.isFinite(viewportWidth) ||
      !Number.isFinite(viewportHeight) ||
      viewportWidth <= 0 ||
      viewportHeight <= 0
    ) {
      return null
    }

    return {
      width: viewportWidth,
      height: viewportHeight,
      translateX,
      translateY,
      zoom: viewportZoom,
    }
  }, [translateX, translateY, viewportHeight, viewportWidth, viewportZoom])

  const placement = React.useMemo(() => {
    return resolveExplorerWindowPlacement({
      spaceRect: rect,
      preferredWidth:
        manualWidth ??
        resolveExplorerAutoPreferredWidth(
          agentSettings.standardWindowSizeBucket,
          agentSettings.defaultProvider,
        ),
      preferredHeight: Math.max(0, Math.floor(rect.height - 64)),
      preferredOffset: manualOffset ?? resolveExplorerDefaultOffset(),
      viewport: viewportBounds,
    })
  }, [
    agentSettings.defaultProvider,
    agentSettings.standardWindowSizeBucket,
    manualOffset,
    manualWidth,
    rect,
    viewportBounds,
  ])

  const stopResize = React.useCallback(() => {
    resizeStartRef.current = null
    resizeCleanupRef.current?.()
    resizeCleanupRef.current = null
  }, [])

  const stopWindowDrag = React.useCallback(() => {
    dragStartRef.current = null
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
  }, [])

  React.useEffect(() => {
    return () => {
      stopResize()
      stopWindowDrag()
    }
  }, [stopResize, stopWindowDrag])

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      containerRef.current?.focus({ preventScroll: true })
    }, 0)

    return () => {
      window.clearTimeout(handle)
    }
  }, [])

  const resolveExplorerPlacementPx = React.useCallback(() => {
    const element = containerRef.current
    const canvas = element?.closest('.workspace-canvas') as HTMLElement | null
    if (!element || !canvas) {
      return undefined
    }

    const elementRect = element.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    if (
      elementRect.width <= 0 ||
      elementRect.height <= 0 ||
      !Number.isFinite(elementRect.left) ||
      !Number.isFinite(elementRect.top)
    ) {
      return undefined
    }

    return {
      left: Math.round(elementRect.left - canvasRect.left),
      top: Math.round(elementRect.top - canvasRect.top),
      width: Math.round(elementRect.width),
      height: Math.round(elementRect.height),
    }
  }, [])

  const handleOpenFile = React.useCallback(
    (uri: string) => {
      onOpenFile(uri, {
        explorerPlacementPx: resolveExplorerPlacementPx(),
      })
    },
    [onOpenFile, resolveExplorerPlacementPx],
  )

  const handlePreviewFile = React.useCallback(
    (uri: string) => {
      onPreviewFile(uri, {
        explorerPlacementPx: resolveExplorerPlacementPx(),
      })
    },
    [onPreviewFile, resolveExplorerPlacementPx],
  )

  const handleWindowDragStart = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }

      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('button, input, textarea, select, .nodrag')) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      containerRef.current?.focus({ preventScroll: true })
      stopWindowDrag()

      const startOffset = placement.offset
      dragStartRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startOffset,
        zoom: viewportZoom,
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const dragStart = dragStartRef.current
        if (!dragStart) {
          return
        }

        moveEvent.preventDefault()
        const nextOffset = {
          x: dragStart.startOffset.x + (moveEvent.clientX - dragStart.startX) / dragStart.zoom,
          y: dragStart.startOffset.y + (moveEvent.clientY - dragStart.startY) / dragStart.zoom,
        }
        const clampedPlacement = resolveExplorerWindowPlacement({
          spaceRect: rect,
          preferredWidth: placement.width,
          preferredHeight: placement.height,
          preferredOffset: nextOffset,
          viewport: viewportBounds,
        })
        setManualOffset(clampedPlacement.offset)
      }

      const handleEnd = () => {
        stopWindowDrag()
      }

      window.addEventListener('pointermove', handleMove, true)
      window.addEventListener('pointerup', handleEnd, true)
      window.addEventListener('pointercancel', handleEnd, true)
      dragCleanupRef.current = () => {
        window.removeEventListener('pointermove', handleMove, true)
        window.removeEventListener('pointerup', handleEnd, true)
        window.removeEventListener('pointercancel', handleEnd, true)
      }
    },
    [
      placement.height,
      placement.offset,
      placement.width,
      rect,
      stopWindowDrag,
      viewportBounds,
      viewportZoom,
    ],
  )

  const handleResizeStart = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation()
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      containerRef.current?.focus({ preventScroll: true })
      stopResize()

      resizeStartRef.current = {
        startX: event.clientX,
        startWidth: placement.width,
        minWidth: placement.minWidth,
        maxWidth: placement.maxWidth,
        zoom: viewportZoom,
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const resizeStart = resizeStartRef.current
        if (!resizeStart) {
          return
        }

        moveEvent.preventDefault()
        const deltaFlow = (moveEvent.clientX - resizeStart.startX) / resizeStart.zoom
        const nextWidth = Math.min(
          resizeStart.maxWidth,
          Math.max(resizeStart.minWidth, resizeStart.startWidth + deltaFlow),
        )
        setManualWidth(nextWidth)
      }

      const handleEnd = () => {
        stopResize()
      }

      window.addEventListener('pointermove', handleMove, true)
      window.addEventListener('pointerup', handleEnd, true)
      window.addEventListener('pointercancel', handleEnd, true)
      resizeCleanupRef.current = () => {
        window.removeEventListener('pointermove', handleMove, true)
        window.removeEventListener('pointerup', handleEnd, true)
        window.removeEventListener('pointercancel', handleEnd, true)
      }
    },
    [placement.maxWidth, placement.minWidth, placement.width, stopResize, viewportZoom],
  )

  if (placement.width <= 0 || placement.height <= 0) {
    return null
  }

  const screenLeft = Math.round(placement.left * viewportZoom + translateX)
  const screenTop = Math.round(placement.top * viewportZoom + translateY)

  return (
    <section
      ref={containerRef}
      className="workspace-space-explorer workspace-space-explorer--node"
      data-testid="workspace-space-explorer"
      tabIndex={0}
      style={{
        width: placement.width,
        height: placement.height,
        transform: `translate3d(${screenLeft}px, ${screenTop}px, 0) scale(${viewportZoom})`,
      }}
      onPointerDown={event => {
        event.stopPropagation()
        containerRef.current?.focus({ preventScroll: true })
      }}
      onClick={event => {
        event.stopPropagation()
      }}
      onWheelCapture={event => {
        event.stopPropagation()
      }}
    >
      <WorkspaceSpaceExplorerOverlayBody
        spaceName={spaceName}
        spaceId={spaceId}
        rootUri={rootUri}
        mountId={mountIdForFilesystem}
        rootResolveError={rootResolveError}
        explorerClipboard={explorerClipboard}
        setExplorerClipboard={setExplorerClipboard}
        findBlockingOpenDocument={findBlockingOpenDocument}
        onClose={onClose}
        onShowMessage={onShowMessage}
        createInputRef={createInputRef}
        renameInputRef={renameInputRef}
        containerRef={containerRef}
        onWindowDragStart={handleWindowDragStart}
        onPreviewFile={handlePreviewFile}
        onOpenFile={handleOpenFile}
        onDismissQuickPreview={onDismissQuickPreview}
      />

      <div
        className="workspace-space-explorer__resize-handle nodrag"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('spaceExplorer.resizeWidth')}
        onPointerDown={handleResizeStart}
      />
    </section>
  )
}
