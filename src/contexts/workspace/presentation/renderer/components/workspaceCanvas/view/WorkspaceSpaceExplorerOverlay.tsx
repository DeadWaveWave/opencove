import React from 'react'
import { useStore } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { ResolveMountTargetResult } from '@shared/contracts/dto'
import type { ShowWorkspaceCanvasMessage } from '../types'
import type { SpaceExplorerOpenDocumentBlock } from '../hooks/useSpaceExplorer.guards'
import { toErrorMessage } from '../helpers'
import { selectViewportTransform } from './WorkspaceSpaceExplorerOverlay.helpers'
import {
  resolveExplorerAutoPreferredWidth,
  resolveExplorerPlacement,
} from './WorkspaceSpaceExplorerOverlay.layout'
import type { SpaceExplorerClipboardItem } from './WorkspaceSpaceExplorerOverlay.operations'
import { WorkspaceSpaceExplorerOverlayBody } from './WorkspaceSpaceExplorerOverlayBody'

export function WorkspaceSpaceExplorerOverlay({
  canvasRef,
  spaceId,
  spaceName,
  targetMountId,
  directoryPath,
  rect,
  explorerClipboard,
  setExplorerClipboard,
  findBlockingOpenDocument,
  onShowMessage,
  onClose,
  onPreviewFile,
  onOpenFile,
  onDismissQuickPreview,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  spaceId: string
  spaceName: string
  targetMountId: string | null
  directoryPath: string
  rect: { x: number; y: number; width: number; height: number }
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
}): React.JSX.Element {
  const { t } = useTranslation()
  const transform = useStore(selectViewportTransform)
  const containerRef = React.useRef<HTMLElement | null>(null)
  const createInputRef = React.useRef<HTMLInputElement | null>(null)
  const renameInputRef = React.useRef<HTMLInputElement | null>(null)
  const placementRef = React.useRef<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const resizeStartRef = React.useRef<{
    startX: number
    startWidth: number
    minWidth: number
    maxWidth: number
  } | null>(null)
  const [manualWidth, setManualWidth] = React.useState<number | null>(null)
  const [canvasSize, setCanvasSize] = React.useState({ width: 0, height: 0 })

  const trimmedDirectoryPath = directoryPath.trim()
  const directoryRootUri = React.useMemo(
    () => (trimmedDirectoryPath.length > 0 ? toFileUri(trimmedDirectoryPath) : null),
    [trimmedDirectoryPath],
  )
  const [resolvedMountRootUri, setResolvedMountRootUri] = React.useState<string | null>(null)
  const [rootResolveError, setRootResolveError] = React.useState<string | null>(null)

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

  const pixelRect = React.useMemo(() => {
    const [translateX, translateY, zoom] = transform
    return {
      x: rect.x * zoom + translateX,
      y: rect.y * zoom + translateY,
      width: rect.width * zoom,
      height: rect.height * zoom,
    }
  }, [rect.height, rect.width, rect.x, rect.y, transform])

  const placement = React.useMemo(() => {
    const canvasWidth = canvasSize.width > 0 ? canvasSize.width : 1280
    const canvasHeight = canvasSize.height > 0 ? canvasSize.height : 720
    return resolveExplorerPlacement({
      canvasWidth,
      canvasHeight,
      pixelRect,
      preferredWidth: manualWidth ?? resolveExplorerAutoPreferredWidth(rect.width),
      preferredHeight: Math.max(0, Math.floor(rect.height - 20)),
    })
  }, [canvasSize.height, canvasSize.width, manualWidth, pixelRect, rect.height, rect.width])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      setCanvasSize({
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
      })
      return
    }

    const update = () => {
      setCanvasSize({
        width: Math.max(0, Math.round(canvas.clientWidth)),
        height: Math.max(0, Math.round(canvas.clientHeight)),
      })
    }

    update()
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(canvas)
    return () => {
      resizeObserver.disconnect()
    }
  }, [canvasRef])

  React.useEffect(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) {
      return
    }

    const isSpaceVisible =
      pixelRect.x + pixelRect.width > 0 &&
      pixelRect.x < canvasSize.width &&
      pixelRect.y + pixelRect.height > 0 &&
      pixelRect.y < canvasSize.height

    if (!isSpaceVisible) {
      onClose()
    }
  }, [
    canvasSize.height,
    canvasSize.width,
    onClose,
    pixelRect.height,
    pixelRect.width,
    pixelRect.x,
    pixelRect.y,
  ])

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      containerRef.current?.focus({ preventScroll: true })
    }, 0)

    return () => {
      window.clearTimeout(handle)
    }
  }, [])

  placementRef.current = {
    left: placement.left,
    top: placement.top,
    width: placement.width,
    height: placement.height,
  }

  const handleOpenFile = React.useCallback(
    (uri: string) => {
      const nextPlacement = placementRef.current
      onOpenFile(uri, {
        explorerPlacementPx: nextPlacement
          ? {
              left: nextPlacement.left,
              top: nextPlacement.top,
              width: nextPlacement.width,
              height: nextPlacement.height,
            }
          : undefined,
      })
    },
    [onOpenFile],
  )

  const handlePreviewFile = React.useCallback(
    (uri: string) => {
      const nextPlacement = placementRef.current
      onPreviewFile(uri, {
        explorerPlacementPx: nextPlacement
          ? {
              left: nextPlacement.left,
              top: nextPlacement.top,
              width: nextPlacement.width,
              height: nextPlacement.height,
            }
          : undefined,
      })
    },
    [onPreviewFile],
  )

  return (
    <section
      ref={containerRef}
      className="workspace-space-explorer workspace-space-explorer--inside"
      data-testid="workspace-space-explorer"
      tabIndex={0}
      style={{
        width: placement.width,
        height: placement.height,
        left: placement.left,
        top: placement.top,
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
        onPreviewFile={handlePreviewFile}
        onOpenFile={handleOpenFile}
        onDismissQuickPreview={onDismissQuickPreview}
      />

      <div
        className="workspace-space-explorer__resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('spaceExplorer.resizeWidth')}
        onPointerDown={event => {
          event.stopPropagation()
          if (event.button !== 0) {
            return
          }

          resizeStartRef.current = {
            startX: event.clientX,
            startWidth: placement.width,
            minWidth: placement.minWidth,
            maxWidth: placement.maxWidth,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onMouseDown={event => {
          event.stopPropagation()
          if (event.button !== 0) {
            return
          }

          resizeStartRef.current = {
            startX: event.clientX,
            startWidth: placement.width,
            minWidth: placement.minWidth,
            maxWidth: placement.maxWidth,
          }

          const handleMove = (moveEvent: MouseEvent) => {
            const resizeStart = resizeStartRef.current
            if (!resizeStart) {
              return
            }

            const nextWidth = Math.min(
              resizeStart.maxWidth,
              Math.max(
                resizeStart.minWidth,
                resizeStart.startWidth + moveEvent.clientX - resizeStart.startX,
              ),
            )
            setManualWidth(nextWidth)
          }

          const handleUp = () => {
            resizeStartRef.current = null
            document.removeEventListener('mousemove', handleMove)
            document.removeEventListener('mouseup', handleUp)
          }

          document.addEventListener('mousemove', handleMove)
          document.addEventListener('mouseup', handleUp)
        }}
        onPointerMove={event => {
          const resizeStart = resizeStartRef.current
          if (!resizeStart) {
            return
          }

          event.stopPropagation()
          const nextWidth = Math.min(
            resizeStart.maxWidth,
            Math.max(
              resizeStart.minWidth,
              resizeStart.startWidth + event.clientX - resizeStart.startX,
            ),
          )
          setManualWidth(nextWidth)
        }}
        onPointerUp={event => {
          if (!resizeStartRef.current) {
            return
          }

          event.stopPropagation()
          resizeStartRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={event => {
          if (!resizeStartRef.current) {
            return
          }

          event.stopPropagation()
          resizeStartRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
      />
    </section>
  )
}
