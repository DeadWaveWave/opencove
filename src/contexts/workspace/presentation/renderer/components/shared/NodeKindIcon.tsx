import type { JSX } from 'react'
import { Bot, ContactRound, Globe, Image, ListTodo, StickyNote, Terminal } from 'lucide-react'
import type { WorkspaceNodeKind } from '../../types'
import { FileSystemEntryIcon } from './FileSystemEntryIcon'
import { PluginIcon } from '@contexts/plugins/presentation/renderer/PluginIcon'

const NODE_KIND_ICONS = {
  terminal: Terminal,
  agent: Bot,
  note: StickyNote,
  task: ListTodo,
  role: ContactRound,
  website: Globe,
  image: Image,
} as const

export function NodeKindIcon({
  kind,
  className,
  filePath,
  pluginId,
}: {
  kind: WorkspaceNodeKind
  className?: string
  filePath?: string
  pluginId?: string
}): JSX.Element {
  const iconClassName = ['cove-node-kind-icon', className].filter(Boolean).join(' ')
  if (kind === 'plugin') {
    return <PluginIcon pluginId={pluginId ?? ''} className={iconClassName} />
  }
  if (kind === 'document' || kind === 'folder') {
    return (
      <FileSystemEntryIcon
        path={filePath ?? ''}
        kind={kind === 'folder' ? 'directory' : 'file'}
        nodeKind={kind}
        className={iconClassName}
      />
    )
  }
  const Icon = NODE_KIND_ICONS[kind]
  return (
    <Icon
      className={iconClassName}
      data-cove-part="icon"
      data-cove-kind={kind}
      data-cove-node-kind-icon={kind}
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
    />
  )
}
