import {
  resolveFileContentDescriptor,
  type FileMediaDescriptor,
  type FileMediaKind,
} from '../../../domain/fileContentType'

export type DocumentNodeMediaKind = FileMediaKind
export type DocumentNodeMediaDescriptor = FileMediaDescriptor

export function resolveDocumentNodeMediaDescriptor(
  uri: string,
): DocumentNodeMediaDescriptor | null {
  const descriptor = resolveFileContentDescriptor(uri)
  return descriptor?.kind === 'binary' ? null : descriptor
}

export function createMediaObjectUrl(bytes: Uint8Array, mimeType: string): string {
  const safeBytes: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength)
  safeBytes.set(bytes)
  return URL.createObjectURL(new Blob([safeBytes], { type: mimeType }))
}

export function canPlayDocumentNodeMedia(
  mediaKind: Exclude<DocumentNodeMediaKind, 'image'>,
  mimeType: string,
): boolean {
  if (typeof document === 'undefined') {
    return true
  }

  const element = document.createElement(mediaKind)
  return element.canPlayType(mimeType).trim().length > 0
}

export async function readVideoNaturalDimensions(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ naturalWidth: number | null; naturalHeight: number | null }> {
  let objectUrl: string | null = null

  try {
    objectUrl = createMediaObjectUrl(bytes, mimeType)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.playsInline = true

    const loaded = await new Promise<boolean>(resolve => {
      video.onloadedmetadata = () => resolve(true)
      video.onerror = () => resolve(false)
      video.src = objectUrl as string
    })

    if (!loaded) {
      return { naturalWidth: null, naturalHeight: null }
    }

    const naturalWidth = Number.isFinite(video.videoWidth) ? video.videoWidth : null
    const naturalHeight = Number.isFinite(video.videoHeight) ? video.videoHeight : null
    return { naturalWidth, naturalHeight }
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
  }
}
