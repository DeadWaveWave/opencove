import {
  useCallback,
  useLayoutEffect,
  useRef,
  type DragEventHandler,
  type MutableRefObject,
} from 'react'
import { useReactFlow } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { CANVAS_IMAGE_MIME_TYPES } from '@shared/contracts/dto'
import type { Point, WorkspaceSpaceState } from '../../../types'
import { getCollapsedNodeSize } from '../../../utils/canvasCollapse'
import {
  hasFilesystemEntryDragData,
  isFilesystemCanvasDropTarget,
  type FilesystemEntryDragData,
} from '../filesystemDrag'
import {
  hasNativeFileTransfer,
  readNativeDroppedFiles,
  toNativeFilesystemEntry,
} from '../nativeFilesystemDrop'
import { toErrorMessage } from '../helpers'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { findContainingSpaceByAnchor } from './useInteractions.spaceAssignment'

export interface FilesystemMaterializeOptions {
  collapsed?: boolean
  /** undefined resolves by anchor; null preserves a drop onto the root canvas. */
  targetSpaceId?: string | null
}

export function useNativeFilesystemDrop({
  workspaceId,
  spacesRef,
  materialize,
  onShowMessage,
}: {
  workspaceId: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  materialize: (
    entry: FilesystemEntryDragData,
    anchor: Point,
    isSourceCurrent?: () => boolean,
    options?: FilesystemMaterializeOptions,
  ) => Promise<void>
  onShowMessage?: ShowWorkspaceCanvasMessage
}) {
  const { t } = useTranslation()
  const reactFlow = useReactFlow()
  const lifetime = useRef<object | null>(null)
  useLayoutEffect(() => {
    lifetime.current = {}
    return () => {
      lifetime.current = null
    }
  }, [workspaceId])

  const handleNativeDragOver = useCallback<DragEventHandler<HTMLDivElement>>(event => {
    if (isFilesystemCanvasDropTarget(event.target) && hasNativeFileTransfer(event.dataTransfer)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleNativeDrop = useCallback<DragEventHandler<HTMLDivElement>>(
    event => {
      const transfer = event.dataTransfer
      if (
        !isFilesystemCanvasDropTarget(event.target) ||
        hasFilesystemEntryDragData(transfer) ||
        !hasNativeFileTransfer(transfer)
      ) {
        return
      }
      const files = readNativeDroppedFiles(transfer)
      if (!files.length) {
        const imageFiles = Array.from(transfer.files ?? []).filter(file =>
          (CANVAS_IMAGE_MIME_TYPES as readonly string[]).includes(file.type),
        )
        if (imageFiles.length < transfer.files.length) {
          onShowMessage?.(t('spaceExplorer.nativeDropUnavailable'), 'warning')
        }
        // The existing image importer still owns clipboard/web-created images.
        if (!imageFiles.length) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const anchor = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const targetSpaceId = findContainingSpaceByAnchor(spacesRef.current, anchor)?.id ?? null
      const epoch = lifetime.current
      const isCurrent = () =>
        epoch !== null &&
        lifetime.current === epoch &&
        (targetSpaceId === null || spacesRef.current.some(space => space.id === targetSpaceId))
      const resolveDroppedFile = window.opencoveApi.filesystem.resolveDroppedFile!
      void (async () => {
        for (const [index, file] of files.entries()) {
          if (!isCurrent()) {
            return
          }
          try {
            // Stop authorizing remaining entries as soon as this canvas is no longer current.
            // eslint-disable-next-line no-await-in-loop
            const entry = toNativeFilesystemEntry(await resolveDroppedFile(file))
            if (!isCurrent()) {
              return
            }
            if (entry) {
              const size = getCollapsedNodeSize()
              // Each placement must see the preceding node's published collision geometry.
              // eslint-disable-next-line no-await-in-loop
              await materialize(
                entry,
                {
                  x: anchor.x + (index % 4) * (size.width + 20),
                  y: anchor.y + Math.floor(index / 4) * (size.height + 20),
                },
                isCurrent,
                { collapsed: true, targetSpaceId },
              )
            }
          } catch (error) {
            if (isCurrent()) {
              onShowMessage?.(
                t('spaceExplorer.openFailed', { message: toErrorMessage(error) }),
                'error',
              )
            }
          }
        }
      })()
    },
    [materialize, onShowMessage, reactFlow, spacesRef, t],
  )

  return { handleNativeDragOver, handleNativeDrop }
}
