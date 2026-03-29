import type { CanvasImageMimeType } from '@shared/contracts/dto'

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
