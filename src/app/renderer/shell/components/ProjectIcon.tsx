import React from 'react'
import { PixelGlyph } from '@app/renderer/components/ui/PixelGlyph'
import type { PixelGlyphName } from '@app/renderer/components/ui/pixelGlyphs'
import type { ProjectIconId } from '@shared/types/projectIcon'

/** Each project icon choice as a pixel glyph (Tide: the rail's tiles are pixel icons). */
const PROJECT_ICON_GLYPHS: Record<ProjectIconId, PixelGlyphName> = {
  code: 'code',
  terminal: 'terminal',
  database: 'database',
  globe: 'website',
  package: 'package',
  bot: 'bot',
  briefcase: 'briefcase',
  'book-open': 'book',
}

export function projectIconGlyph(iconId: ProjectIconId | null): PixelGlyphName {
  return iconId ? (PROJECT_ICON_GLYPHS[iconId] ?? 'folder') : 'folder'
}

export function ProjectIcon({
  iconId,
  className,
}: {
  iconId?: ProjectIconId | null
  /** Kept for callers; the pixel folder is the same open or closed. */
  isExpanded?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <PixelGlyph
      name={projectIconGlyph(iconId ?? null)}
      className={className}
      data-cove-project-icon-id={iconId ?? 'default'}
    />
  )
}
