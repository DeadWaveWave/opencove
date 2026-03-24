import {
  useCallback,
  type ClipboardEvent,
  type ClipboardEventHandler,
  type DragEventHandler,
} from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import {
  CANVAS_IMAGE_MIME_TYPES,
  MAX_CANVAS_IMAGE_BYTES,
  type CanvasImageMimeType,
} from '@shared/contracts/dto'
import type { ImageNodeData, Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveDefaultImageWindowSize } from '../constants'
import { resolveNodePlacementAnchorFromViewportCenter, toErrorMessage } from '../helpers'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'

const DEFAULT_IMPORT_STACK_OFFSET_PX = 22

function isCanvasImageMimeType(value: string): value is CanvasImageMimeType {
  return CANVAS_IMAGE_MIME_TYPES.includes(value as CanvasImageMimeType)
}

function normalizeOptionalFileName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function resolveImageNaturalSize(file: File): Promise<{
  naturalWidth: number | null
  naturalHeight: number | null
}> {
  if (typeof createImageBitmap !== 'function') {
    return { naturalWidth: null, naturalHeight: null }
  }

  try {
    const bitmap = await createImageBitmap(file)
    const naturalWidth = bitmap.width
    const naturalHeight = bitmap.height
    bitmap.close?.()
    return {
      naturalWidth: Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : null,
      naturalHeight: Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : null,
    }
  } catch {
    return { naturalWidth: null, naturalHeight: null }
  }
}

function extractImageFilesFromClipboard(event: ClipboardEvent<HTMLDivElement>): File[] {
  const clipboard = event.clipboardData
  if (!clipboard) {
    return []
  }

  const files: File[] = []

  if (clipboard.items && clipboard.items.length > 0) {
    for (const item of clipboard.items) {
      if (item.kind !== 'file') {
        continue
      }

      const file = item.getAsFile()
      if (file) {
        files.push(file)
      }
    }
  }

  if (files.length === 0 && clipboard.files && clipboard.files.length > 0) {
    files.push(...Array.from(clipboard.files))
  }

  return files
}

function resolveCanvasClientCenter(canvas: HTMLDivElement | null): Point {
  if (!canvas) {
    return {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2),
    }
  }

  const rect = canvas.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function useWorkspaceCanvasImageImport({
  canvasRef,
  reactFlow,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onShowMessage,
  createImageNode,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onShowMessage?: (message: string, tone?: 'info' | 'warning' | 'error') => void
  createImageNode: (
    anchor: Point,
    image: ImageNodeData,
    placement?: { targetSpaceRect?: WorkspaceSpaceState['rect'] | null },
  ) => Node<TerminalNodeData> | null
}): {
  handleCanvasPaste: ClipboardEventHandler<HTMLDivElement>
  handleCanvasDragOver: DragEventHandler<HTMLDivElement>
  handleCanvasDrop: DragEventHandler<HTMLDivElement>
} {
  const { t } = useTranslation()

  const importFiles = useCallback(
    async (files: File[], baseFlowCenter: Point) => {
      const writeCanvasImage = window.opencoveApi?.workspace?.writeCanvasImage
      if (typeof writeCanvasImage !== 'function') {
        return
      }

      const deleteCanvasImage = window.opencoveApi?.workspace?.deleteCanvasImage
      const defaultSize = resolveDefaultImageWindowSize()
      const maxMegabytes = Math.round(MAX_CANVAS_IMAGE_BYTES / 1024 / 1024)

      const prepared = await Promise.all(
        files.map(async (file, index) => {
          const mimeType = typeof file.type === 'string' ? file.type.trim() : ''

          if (!isCanvasImageMimeType(mimeType)) {
            onShowMessage?.(t('messages.canvasImageUnsupportedType'), 'warning')
            return null
          }

          if (typeof file.size === 'number' && file.size > MAX_CANVAS_IMAGE_BYTES) {
            onShowMessage?.(t('messages.canvasImageTooLarge', { maxMb: maxMegabytes }), 'warning')
            return null
          }

          let bytes: Uint8Array
          try {
            bytes = new Uint8Array(await file.arrayBuffer())
          } catch (error) {
            onShowMessage?.(
              t('messages.canvasImageImportFailed', { message: toErrorMessage(error) }),
              'error',
            )
            return null
          }

          const assetId = crypto.randomUUID()
          const fileName = normalizeOptionalFileName(file.name)
          const { naturalWidth, naturalHeight } = await resolveImageNaturalSize(file)

          try {
            await writeCanvasImage({ assetId, bytes, mimeType, fileName })
          } catch (error) {
            onShowMessage?.(
              t('messages.canvasImageImportFailed', { message: toErrorMessage(error) }),
              'error',
            )
            return null
          }

          return { index, assetId, mimeType, fileName, naturalWidth, naturalHeight }
        }),
      )

      for (const item of prepared) {
        if (!item) {
          continue
        }

        const offset = item.index * DEFAULT_IMPORT_STACK_OFFSET_PX
        const flowCenter = {
          x: baseFlowCenter.x + offset,
          y: baseFlowCenter.y + offset,
        }

        const anchor = resolveNodePlacementAnchorFromViewportCenter(flowCenter, defaultSize)
        const targetSpace = findContainingSpaceByAnchor(spacesRef.current, flowCenter)

        const node = createImageNode(
          anchor,
          {
            assetId: item.assetId,
            mimeType: item.mimeType,
            fileName: item.fileName,
            naturalWidth: item.naturalWidth,
            naturalHeight: item.naturalHeight,
          },
          {
            targetSpaceRect: targetSpace?.rect ?? null,
          },
        )

        if (!node) {
          if (typeof deleteCanvasImage === 'function') {
            void deleteCanvasImage({ assetId: item.assetId }).catch(() => undefined)
          }
          continue
        }

        if (targetSpace) {
          assignNodeToSpaceAndExpand({
            createdNodeId: node.id,
            targetSpaceId: targetSpace.id,
            spacesRef,
            nodesRef,
            setNodes,
            onSpacesChange,
          })
        }
      }
    },
    [createImageNode, nodesRef, onShowMessage, onSpacesChange, setNodes, spacesRef, t],
  )

  const handleCanvasPaste = useCallback<ClipboardEventHandler<HTMLDivElement>>(
    event => {
      const files = extractImageFilesFromClipboard(event)
      const supportedImages = files.filter(file =>
        typeof file.type === 'string' ? isCanvasImageMimeType(file.type.trim()) : false,
      )
      if (supportedImages.length === 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const canvasCenter = resolveCanvasClientCenter(canvasRef.current)
      const flowCenter = reactFlow.screenToFlowPosition(canvasCenter)
      void importFiles(supportedImages, flowCenter)
    },
    [canvasRef, importFiles, reactFlow],
  )

  const handleCanvasDragOver = useCallback<DragEventHandler<HTMLDivElement>>(event => {
    const transfer = event.dataTransfer
    if (!transfer) {
      return
    }

    const items = Array.from(transfer.items ?? [])
    const hasImage =
      items.length > 0
        ? items.some(item => item.kind === 'file' && isCanvasImageMimeType(item.type))
        : Array.from(transfer.files ?? []).some(file =>
            typeof file.type === 'string' ? isCanvasImageMimeType(file.type.trim()) : false,
          )

    if (!hasImage) {
      return
    }

    event.preventDefault()
    transfer.dropEffect = 'copy'
  }, [])

  const handleCanvasDrop = useCallback<DragEventHandler<HTMLDivElement>>(
    event => {
      const transfer = event.dataTransfer
      if (!transfer) {
        return
      }

      const files = Array.from(transfer.files ?? [])
      const supportedImages = files.filter(file =>
        typeof file.type === 'string' ? isCanvasImageMimeType(file.type.trim()) : false,
      )
      if (supportedImages.length === 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const flowCenter = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      void importFiles(supportedImages, flowCenter)
    },
    [importFiles, reactFlow],
  )

  return {
    handleCanvasPaste,
    handleCanvasDragOver,
    handleCanvasDrop,
  }
}
