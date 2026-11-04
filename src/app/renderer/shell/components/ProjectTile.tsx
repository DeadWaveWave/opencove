import React from 'react'
import type { ProjectIconId } from '@shared/types/projectIcon'
import { resolveProjectAccent } from '../utils/projectAccent'
import { ProjectIcon } from './ProjectIcon'

/** The project's icon on a tint of its accent; the rail, inbox and search share it. */
export function ProjectTile({
  workspaceId,
  iconId,
  isExpanded = false,
  size = 'md',
  className,
  iconClassName,
  children,
}: {
  workspaceId: string
  iconId?: ProjectIconId | null
  isExpanded?: boolean
  size?: 'sm' | 'md'
  className?: string
  iconClassName?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={`cove-project-tile${className ? ` ${className}` : ''}`}
      data-cove-accent={resolveProjectAccent(workspaceId)}
      data-size={size}
    >
      <ProjectIcon
        iconId={iconId}
        isExpanded={isExpanded}
        className={`cove-project-tile__icon${iconClassName ? ` ${iconClassName}` : ''}`}
      />
      {children}
    </span>
  )
}
