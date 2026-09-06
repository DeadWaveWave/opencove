import type { JSX } from 'react'
import {
  Bot,
  ContactRound,
  FileText,
  Globe,
  Image,
  ListTodo,
  StickyNote,
  Terminal,
} from 'lucide-react'
import type { WorkspaceNodeKind } from '../../types'

const NODE_KIND_ICONS = {
  terminal: Terminal,
  agent: Bot,
  note: StickyNote,
  document: FileText,
  task: ListTodo,
  role: ContactRound,
  website: Globe,
  image: Image,
} as const

export function NodeKindIcon({
  kind,
  className,
}: {
  kind: WorkspaceNodeKind
  className?: string
}): JSX.Element {
  const Icon = NODE_KIND_ICONS[kind]
  return (
    <Icon
      className={['cove-node-kind-icon', className].filter(Boolean).join(' ')}
      data-cove-node-kind-icon={kind}
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
    />
  )
}
