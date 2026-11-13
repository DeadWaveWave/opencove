import type { JSX } from 'react'
import { FileCodeIcon, FileTextIcon, FolderIcon } from '@app/renderer/components/ui/pixelIcons'
import { fromFileUri } from '@contexts/filesystem/domain'

export type FileSystemEntryIconKind = 'folder' | 'file-text' | 'file-json' | 'file-code-2'

const CODE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cs',
  'css',
  'go',
  'h',
  'hpp',
  'htm',
  'html',
  'java',
  'js',
  'jsx',
  'kt',
  'less',
  'lua',
  'mjs',
  'cjs',
  'php',
  'py',
  'r',
  'rb',
  'rs',
  'sass',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'ts',
  'tsx',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
])

const ICONS = {
  folder: FolderIcon,
  'file-text': FileTextIcon,
  'file-json': FileCodeIcon,
  'file-code-2': FileCodeIcon,
} as const

/** Identity is a presentation hint from the entry name, never a content or MIME claim. */
export function resolveFileSystemEntryIconKind(
  path: string,
  kind: 'file' | 'directory',
): FileSystemEntryIconKind {
  if (kind === 'directory') {
    return 'folder'
  }
  let decoded = path
  try {
    decoded = fromFileUri(path) ?? path
  } catch {
    // Malformed/legacy URI text must still have a stable decorative fallback.
  }
  const name = decoded.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  const extension = name.includes('.') ? (name.split('.').at(-1) ?? '') : ''
  if (extension === 'json' || extension === 'jsonc' || extension === 'json5') {
    return 'file-json'
  }
  return CODE_EXTENSIONS.has(extension) ? 'file-code-2' : 'file-text'
}

export function FileSystemEntryIcon({
  path,
  kind,
  className,
  nodeKind,
}: {
  path: string
  kind: 'file' | 'directory'
  className?: string
  nodeKind?: 'document' | 'folder'
}): JSX.Element {
  const iconKind = resolveFileSystemEntryIconKind(path, kind)
  const Icon = ICONS[iconKind]
  return (
    <Icon
      className={['cove-filesystem-entry-icon', className].filter(Boolean).join(' ')}
      data-cove-part="icon"
      data-cove-kind={nodeKind ?? (kind === 'directory' ? 'folder' : 'document')}
      data-cove-file-icon={iconKind}
      data-cove-node-kind-icon={nodeKind}
      size={18}
    />
  )
}
