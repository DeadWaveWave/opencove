import React from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type {
  DocumentNodeData,
  ImageNodeData,
  Point,
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../types'
import type { CanvasImageMimeType } from '@shared/contracts/dto'
import { focusNodeInViewport } from '../helpers'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import type { NodePlacementOptions } from '../types'

function resolveFileNameFromFileUri(uri: string): string | null {
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'file:') {
      return null
    }
    const pathname = parsed.pathname ?? ''
    const lastSlash = pathname.lastIndexOf('/')
    const rawName = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname
    const decoded = decodeURIComponent(rawName)
    return decoded.trim().length ? decoded : null
  } catch {
    return null
  }
}

function resolveCanvasImageMimeType(uri: string): CanvasImageMimeType | null {
  const fileName = resolveFileNameFromFileUri(uri)?.toLowerCase() ?? ''
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot + 1) : ''
  if (ext === 'png') {
    return 'image/png'
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return 'image/jpeg'
  }
  if (ext === 'webp') {
    return 'image/webp'
  }
  if (ext === 'gif') {
    return 'image/gif'
  }
  if (ext === 'avif') {
    return 'image/avif'
  }
  return null
}

async function readImageNaturalDimensions(
  bytes: Uint8Array,
  mimeType: CanvasImageMimeType,
): Promise<{ naturalWidth: number | null; naturalHeight: number | null }> {
  let objectUrl: string | null = null

  try {
    const safeBytes: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength)
    safeBytes.set(bytes)
    objectUrl = URL.createObjectURL(new Blob([safeBytes], { type: mimeType }))

    const image = new Image()
    const loaded = await new Promise<boolean>(resolve => {
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = objectUrl as string
    })

    if (!loaded) {
      return { naturalWidth: null, naturalHeight: null }
    }

    const width = Number.isFinite(image.naturalWidth) ? image.naturalWidth : null
    const height = Number.isFinite(image.naturalHeight) ? image.naturalHeight : null
    return { naturalWidth: width, naturalHeight: height }
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

export function useWorkspaceCanvasSpaceExplorer({
  spaces,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  reactFlow,
  createDocumentNode,
  createImageNode,
}: {
  spaces: WorkspaceSpaceState[]
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  createDocumentNode: (
    anchor: Point,
    document: DocumentNodeData,
    placement?: NodePlacementOptions,
  ) => Node<TerminalNodeData> | null
  createImageNode: (
    anchor: Point,
    image: ImageNodeData,
    placement?: NodePlacementOptions,
  ) => Node<TerminalNodeData> | null
}): {
  openExplorerSpaceId: string | null
  openSpaceExplorer: (spaceId: string) => void
  closeSpaceExplorer: () => void
  toggleSpaceExplorer: (spaceId: string) => void
  openFileInSpace: (spaceId: string, uri: string) => void
} {
  const [openExplorerSpaceId, setOpenExplorerSpaceId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!openExplorerSpaceId) {
      return
    }

    if (spaces.some(space => space.id === openExplorerSpaceId)) {
      return
    }

    setOpenExplorerSpaceId(null)
  }, [openExplorerSpaceId, spaces])

  const openSpaceExplorer = React.useCallback((spaceId: string) => {
    const normalized = spaceId.trim()
    if (normalized.length === 0) {
      return
    }

    setOpenExplorerSpaceId(normalized)
  }, [])

  const closeSpaceExplorer = React.useCallback(() => {
    setOpenExplorerSpaceId(null)
  }, [])

  const toggleSpaceExplorer = React.useCallback((spaceId: string) => {
    const normalized = spaceId.trim()
    if (normalized.length === 0) {
      return
    }

    setOpenExplorerSpaceId(previous => (previous === normalized ? null : normalized))
  }, [])

  const openFileInSpace = React.useCallback(
    (spaceId: string, uri: string) => {
      const normalizedUri = uri.trim()
      if (normalizedUri.length === 0) {
        return
      }

      let parsed: URL | null = null
      try {
        parsed = new URL(normalizedUri)
      } catch {
        parsed = null
      }

      if (!parsed || parsed.protocol !== 'file:') {
        return
      }

      const mimeType = resolveCanvasImageMimeType(normalizedUri)
      const space = spacesRef.current.find(candidate => candidate.id === spaceId) ?? null
      const rect = space?.rect ?? null

      if (!space || !rect) {
        return
      }

      const openAsDocument = () => {
        const existingNode =
          nodesRef.current.find(node => {
            if (node.data.kind !== 'document' || !node.data.document) {
              return false
            }

            if (node.data.document.uri !== normalizedUri) {
              return false
            }

            return space.nodeIds.includes(node.id)
          }) ?? null

        if (existingNode) {
          focusNodeInViewport(reactFlow, existingNode, { duration: 120, zoom: reactFlow.getZoom() })
          return
        }

        const created = createDocumentNode(
          {
            x: rect.x + 24,
            y: rect.y + 46,
          },
          { uri: normalizedUri },
          { targetSpaceRect: rect },
        )

        if (!created) {
          return
        }

        assignNodeToSpaceAndExpand({
          createdNodeId: created.id,
          targetSpaceId: space.id,
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
        })

        onRequestPersistFlush?.()
      }

      if (mimeType) {
        void (async () => {
          const filesystem = window.opencoveApi?.filesystem
          const workspace = window.opencoveApi?.workspace
          if (!filesystem || typeof filesystem.readFileBytes !== 'function') {
            openAsDocument()
            return
          }
          if (!workspace || typeof workspace.writeCanvasImage !== 'function') {
            openAsDocument()
            return
          }

          try {
            const { bytes } = await filesystem.readFileBytes({ uri: normalizedUri })
            const assetId = crypto.randomUUID()
            const fileName = resolveFileNameFromFileUri(normalizedUri)

            await workspace.writeCanvasImage({ assetId, bytes, mimeType, fileName })
            const { naturalWidth, naturalHeight } = await readImageNaturalDimensions(
              bytes,
              mimeType,
            )

            const created = createImageNode(
              { x: rect.x + 24, y: rect.y + 46 },
              {
                assetId,
                mimeType,
                fileName,
                naturalWidth,
                naturalHeight,
              },
              { targetSpaceRect: rect },
            )

            if (!created) {
              return
            }

            assignNodeToSpaceAndExpand({
              createdNodeId: created.id,
              targetSpaceId: space.id,
              spacesRef,
              nodesRef,
              setNodes,
              onSpacesChange,
            })

            onRequestPersistFlush?.()
          } catch {
            openAsDocument()
          }
        })()
        return
      }

      openAsDocument()
    },
    [
      createDocumentNode,
      createImageNode,
      nodesRef,
      onRequestPersistFlush,
      onSpacesChange,
      reactFlow,
      setNodes,
      spacesRef,
    ],
  )

  return {
    openExplorerSpaceId,
    openSpaceExplorer,
    closeSpaceExplorer,
    toggleSpaceExplorer,
    openFileInSpace,
  }
}
