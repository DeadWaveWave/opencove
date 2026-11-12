import type { JSX } from 'react'
import { AgentProviderMark, hasAgentProviderMark } from '@app/renderer/components/AgentProviderMark'
import { PixelGlyph } from '@app/renderer/components/ui/PixelGlyph'
import type { PixelGlyphName } from '@app/renderer/components/ui/pixelGlyphs'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
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

/**
 * A window's kind icon. An Agent whose provider is known shows that vendor's mark in the AI kind
 * colour (owner, 2026-11-06), so the vendor reads at a glance while the colour still names the kind.
 */
export function NodeKindIcon({
  kind,
  className,
  pluginId,
  provider = null,
}: {
  kind: WorkspaceNodeKind
  className?: string
  /** Kept for callers that pass a document or folder path; the glyph names the kind only. */
  filePath?: string
  pluginId?: string
  /** The Agent's provider; ignored for other kinds. */
  provider?: AgentProvider | null
}): JSX.Element {
  const iconClassName = ['cove-node-kind-icon', className].filter(Boolean).join(' ')
  if (kind === 'plugin') {
    return <PluginIcon pluginId={pluginId ?? ''} className={iconClassName} />
  }
  if (kind === 'agent' && provider && hasAgentProviderMark(provider)) {
    return (
      <AgentProviderMark
        provider={provider}
        className={iconClassName}
        data-cove-part="icon"
        data-cove-kind="agent"
        data-cove-node-kind-icon="agent"
        data-agent-provider={provider}
      />
    )
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
