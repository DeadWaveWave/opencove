import React from 'react'

export function SidebarDisclosureIcon({
  expanded,
  className,
}: {
  expanded: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={`workspace-tree-triangle ${
        expanded ? 'workspace-tree-triangle--down' : 'workspace-tree-triangle--right'
      }${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    />
  )
}
