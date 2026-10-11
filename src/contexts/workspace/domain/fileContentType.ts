export type FileMediaKind = 'image' | 'audio' | 'video'
export interface FileMediaDescriptor {
  kind: FileMediaKind
  mimeType: string
}

export type FileContentDescriptor = FileMediaDescriptor | { kind: 'binary' }

// One preview policy for URI-backed windows, quick previews and opening affordances.
// Unknown extensions still use content-based text/binary detection.
const descriptors: Readonly<Record<string, FileContentDescriptor>> = {
  png: { kind: 'image', mimeType: 'image/png' },
  jpg: { kind: 'image', mimeType: 'image/jpeg' },
  jpeg: { kind: 'image', mimeType: 'image/jpeg' },
  webp: { kind: 'image', mimeType: 'image/webp' },
  gif: { kind: 'image', mimeType: 'image/gif' },
  avif: { kind: 'image', mimeType: 'image/avif' },
  svg: { kind: 'image', mimeType: 'image/svg+xml' },
  bmp: { kind: 'image', mimeType: 'image/bmp' },
  ico: { kind: 'image', mimeType: 'image/x-icon' },
  mp3: { kind: 'audio', mimeType: 'audio/mpeg' },
  ogg: { kind: 'audio', mimeType: 'audio/ogg' },
  oga: { kind: 'audio', mimeType: 'audio/ogg' },
  wav: { kind: 'audio', mimeType: 'audio/wav' },
  wave: { kind: 'audio', mimeType: 'audio/wav' },
  mp4: { kind: 'video', mimeType: 'video/mp4' },
  webm: { kind: 'video', mimeType: 'video/webm' },
  pdf: { kind: 'binary' },
  doc: { kind: 'binary' },
  docx: { kind: 'binary' },
  xls: { kind: 'binary' },
  xlsx: { kind: 'binary' },
  ppt: { kind: 'binary' },
  pptx: { kind: 'binary' },
  odt: { kind: 'binary' },
  ods: { kind: 'binary' },
  odp: { kind: 'binary' },
  zip: { kind: 'binary' },
  rar: { kind: 'binary' },
  '7z': { kind: 'binary' },
  gz: { kind: 'binary' },
  bz2: { kind: 'binary' },
  xz: { kind: 'binary' },
  tar: { kind: 'binary' },
}

export function resolveFileContentDescriptor(uri: string): FileContentDescriptor | null {
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'file:') {
      return null
    }
    const fileName = decodeURIComponent(parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1))
    const dot = fileName.lastIndexOf('.')
    const extension = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
    return Object.hasOwn(descriptors, extension) ? descriptors[extension] : null
  } catch {
    return null
  }
}
