import type { FileSystemStat, ReadFileTextResult } from '@shared/contracts/dto'
import type { LabelColor } from '@shared/types/labelColor'
import type { NodeFrame, Point } from '../types'

export interface DocumentNodeInteractionOptions {
  normalizeViewport?: boolean
  selectNode?: boolean
  clearSelection?: boolean
  shiftKey?: boolean
}

export interface DocumentNodeProps {
  title: string
  uri: string
  mountId: string | null
  labelColor?: LabelColor | null
  position: Point
  width: number
  height: number
  onClose: () => void
  onResize: (frame: NodeFrame) => void
  onInteractionStart?: (options?: DocumentNodeInteractionOptions) => void
}

export interface DocumentNodeFilesystemApi {
  stat: (payload: { uri: string }) => Promise<FileSystemStat>
  readFileText: (payload: { uri: string }) => Promise<ReadFileTextResult>
}

export type DocumentNodeLoadResult =
  | { kind: 'text'; content: string }
  | { kind: 'unsupported'; unsupportedKind: 'binary' | 'tooLarge' }

export const DOCUMENT_NODE_MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024

export function decodeUriPathname(uri: string): string {
  try {
    const parsed = new URL(uri)
    return decodeURIComponent(parsed.pathname ?? '')
  } catch {
    return uri
  }
}

export function isProbablyBinaryText(content: string): boolean {
  const sample = content.slice(0, 4096)
  if (sample.length === 0) {
    return false
  }

  let suspicious = 0
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index)

    // NUL byte is a strong signal.
    if (code === 0) {
      return true
    }

    // Replacement character indicates invalid UTF-8 sequences were decoded.
    if (code === 0xfffd) {
      suspicious += 1
      continue
    }

    // Control chars (except TAB, LF, CR) are suspicious in source/text files.
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      suspicious += 1
      continue
    }
  }

  return suspicious / sample.length > 0.12
}

export async function loadDocumentNodeContent(
  api: DocumentNodeFilesystemApi,
  uri: string,
  notAFileMessage: string,
): Promise<DocumentNodeLoadResult> {
  const stat = await api.stat({ uri })
  if (stat.kind !== 'file') {
    throw new Error(notAFileMessage)
  }

  if (typeof stat.sizeBytes === 'number' && Number.isFinite(stat.sizeBytes)) {
    if (stat.sizeBytes > DOCUMENT_NODE_MAX_TEXT_FILE_BYTES) {
      return {
        kind: 'unsupported',
        unsupportedKind: 'tooLarge',
      }
    }
  }

  const result = await api.readFileText({ uri })
  if (isProbablyBinaryText(result.content)) {
    return {
      kind: 'unsupported',
      unsupportedKind: 'binary',
    }
  }

  return {
    kind: 'text',
    content: result.content,
  }
}
