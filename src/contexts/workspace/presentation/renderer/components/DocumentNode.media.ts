export type DocumentNodeMediaKind = 'audio' | 'video'

export interface DocumentNodeMediaDescriptor {
  kind: DocumentNodeMediaKind
  mimeType: string
}

const MEDIA_DESCRIPTOR_BY_EXTENSION: Record<string, DocumentNodeMediaDescriptor> = {
  mp3: {
    kind: 'audio',
    mimeType: 'audio/mpeg',
  },
  ogg: {
    kind: 'audio',
    mimeType: 'audio/ogg',
  },
  oga: {
    kind: 'audio',
    mimeType: 'audio/ogg',
  },
  wav: {
    kind: 'audio',
    mimeType: 'audio/wav',
  },
  wave: {
    kind: 'audio',
    mimeType: 'audio/wav',
  },
  mp4: {
    kind: 'video',
    mimeType: 'video/mp4',
  },
  webm: {
    kind: 'video',
    mimeType: 'video/webm',
  },
}

export function resolveDocumentNodeMediaDescriptor(
  uri: string,
): DocumentNodeMediaDescriptor | null {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }

  if (parsed.protocol !== 'file:') {
    return null
  }

  const pathname = parsed.pathname ?? ''
  const lastSlash = pathname.lastIndexOf('/')
  const rawName = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname
  const fileName = decodeURIComponent(rawName).trim().toLowerCase()
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot + 1) : ''

  return MEDIA_DESCRIPTOR_BY_EXTENSION[ext] ?? null
}

export function createMediaObjectUrl(bytes: Uint8Array, mimeType: string): string {
  const safeBytes: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength)
  safeBytes.set(bytes)
  return URL.createObjectURL(new Blob([safeBytes], { type: mimeType }))
}

export function canPlayDocumentNodeMedia(
  mediaKind: DocumentNodeMediaKind,
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
