import React from 'react'
import {
  BookOpen,
  Bot,
  Briefcase,
  Code2,
  Database,
  Folder,
  FolderOpen,
  Globe,
  Package,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import type { ProjectIconId } from '@shared/types/projectIcon'

const PROJECT_ICON_COMPONENTS: Record<ProjectIconId, LucideIcon> = {
  code: Code2,
  terminal: Terminal,
  database: Database,
  globe: Globe,
  package: Package,
  bot: Bot,
  briefcase: Briefcase,
  'book-open': BookOpen,
}

export function getProjectIconComponent(iconId: ProjectIconId | null): LucideIcon | null {
  return iconId ? (PROJECT_ICON_COMPONENTS[iconId] ?? null) : null
}

export function ProjectIcon({
  iconId,
  isExpanded,
  className,
}: {
  iconId?: ProjectIconId | null
  isExpanded: boolean
  className?: string
}): React.JSX.Element {
  const CustomIcon = getProjectIconComponent(iconId ?? null)
  const Icon = CustomIcon ?? (isExpanded ? FolderOpen : Folder)

  return (
    <Icon
      className={className}
      data-cove-project-icon-id={iconId ?? 'default'}
      aria-hidden="true"
    />
  )
}
