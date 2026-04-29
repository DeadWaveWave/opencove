import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { CanvasImageMimeType } from '@shared/contracts/dto'
import {
  resolveDocumentNodeSizeFromMediaMetadata,
  resolveImageNodeSizeFromNaturalDimensions,
} from '../../../utils/workspaceNodeSizing'
import {
  readVideoNaturalDimensions,
  resolveDocumentNodeMediaDescriptor,
} from '../../DocumentNode.media'
import { resolveDefaultDocumentWindowSize, resolveDefaultImageWindowSize } from '../constants'
import type { WorkspaceCanvasQuickPreviewState } from '../types'
import { resolveFilesystemApiForMount } from '../../../utils/mountAwareFilesystemApi'

export function resolveFileNameFromFileUri(uri: string): string | null {
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

export function resolveCanvasImageMimeType(uri: string): CanvasImageMimeType | null {
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

export async function readImageNaturalDimensions(
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

export async function resolveSpaceExplorerPreviewDisplay(options: {
  uri: string
  mountId: string | null
  standardWindowSizeBucket: StandardWindowSizeBucket
}): Promise<{
  kind: WorkspaceCanvasQuickPreviewState['kind']
  naturalWidth: number | null | undefined
  naturalHeight: number | null | undefined
  size: { width: number; height: number }
}> {
  const filesystem = resolveFilesystemApiForMount(options.mountId)
  const imageMimeType = resolveCanvasImageMimeType(options.uri)
  const mediaDescriptor = resolveDocumentNodeMediaDescriptor(options.uri)
  let kind: WorkspaceCanvasQuickPreviewState['kind'] = 'document'
  let naturalWidth: number | null | undefined
  let naturalHeight: number | null | undefined
  let size = resolveDefaultDocumentWindowSize(options.standardWindowSizeBucket)

  if (imageMimeType) {
    kind = 'image'
    if (filesystem?.readFileBytes) {
      try {
        const { bytes } = await filesystem.readFileBytes({ uri: options.uri })
        const dimensions = await readImageNaturalDimensions(bytes, imageMimeType)
        naturalWidth = dimensions.naturalWidth
        naturalHeight = dimensions.naturalHeight
        size = resolveImageNodeSizeFromNaturalDimensions({
          naturalWidth,
          naturalHeight,
          preferred: resolveDefaultImageWindowSize(),
        })
      } catch {
        size = resolveDefaultImageWindowSize()
      }
    } else {
      size = resolveDefaultImageWindowSize()
    }
  } else if (mediaDescriptor) {
    kind = mediaDescriptor.kind

    if (filesystem?.readFileBytes) {
      try {
        const { bytes } = await filesystem.readFileBytes({ uri: options.uri })
        if (mediaDescriptor.kind === 'video') {
          const dimensions = await readVideoNaturalDimensions(bytes, mediaDescriptor.mimeType)
          naturalWidth = dimensions.naturalWidth
          naturalHeight = dimensions.naturalHeight
        }
      } catch {
        naturalWidth = null
        naturalHeight = null
      }
    }

    size = resolveDocumentNodeSizeFromMediaMetadata({
      mediaKind: mediaDescriptor.kind,
      naturalWidth: naturalWidth ?? null,
      naturalHeight: naturalHeight ?? null,
      preferred: resolveDefaultDocumentWindowSize(options.standardWindowSizeBucket),
    })
  }

  return {
    kind,
    naturalWidth,
    naturalHeight,
    size,
  }
}
