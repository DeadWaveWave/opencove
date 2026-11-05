import type { JSX } from 'react'
import { PixelGlyph } from '@app/renderer/components/ui/PixelGlyph'
import type { PixelGlyphName } from '@app/renderer/components/ui/pixelGlyphs'
import type { WorkspaceNodeKind } from '../../types'
import { PluginIcon } from '@contexts/plugins/presentation/renderer/PluginIcon'

/** Each window kind's pixel glyph (Tide): colour always comes with a pixel icon. */
const NODE_KIND_GLYPHS: Record<Exclude<WorkspaceNodeKind, 'plugin'>, PixelGlyphName> = {
  terminal: 'terminal',
  agent: 'ai',
  note: 'note',
  task: 'task',
  role: 'role',
  website: 'website',
  image: 'image',
  document: 'document',
  folder: 'folder',
}

export function NodeKindIcon({
  kind,
  className,
  pluginId,
}: {
  kind: WorkspaceNodeKind
  className?: string
  /** Kept for callers that pass a document or folder path; the glyph names the kind only. */
  filePath?: string
  pluginId?: string
}): JSX.Element {
  const iconClassName = ['cove-node-kind-icon', className].filter(Boolean).join(' ')
  if (kind === 'plugin') {
    return <PluginIcon pluginId={pluginId ?? ''} className={iconClassName} />
  }
  return (
    <PixelGlyph
      name={NODE_KIND_GLYPHS[kind]}
      className={iconClassName}
      data-cove-part="icon"
      data-cove-kind={kind}
      data-cove-node-kind-icon={kind}
    />
  )
}
