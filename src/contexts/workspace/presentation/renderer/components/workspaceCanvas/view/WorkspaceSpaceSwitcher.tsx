import React from 'react'
import type { WorkspaceSpaceState } from '../../../types'

interface WorkspaceSpaceSwitcherProps {
  spaces: WorkspaceSpaceState[]
  activateSpace: (spaceId: string) => void
  activateAllSpaces: () => void
  cancelSpaceRename: () => void
  onOpenSpaceContextMenu?: (spaceId: string, anchor: { x: number; y: number }) => void
}

export function WorkspaceSpaceSwitcher({
  spaces,
  activateSpace,
  activateAllSpaces,
  cancelSpaceRename,
  onOpenSpaceContextMenu,
}: WorkspaceSpaceSwitcherProps): React.JSX.Element | null {
  if (spaces.length === 0) {
    return null
  }

  return (
    <div
      className="workspace-space-switcher"
      onClick={event => {
        event.stopPropagation()
      }}
    >
      <button
        type="button"
        className="workspace-space-switcher__item"
        data-testid="workspace-space-switch-all"
        onClick={() => {
          activateAllSpaces()
          cancelSpaceRename()
        }}
      >
        All
      </button>
      {spaces.map(space => (
        <button
          type="button"
          key={space.id}
          className="workspace-space-switcher__item"
          data-testid={`workspace-space-switch-${space.id}`}
          data-cove-label-color={space.labelColor ?? undefined}
          onContextMenu={event => {
            event.preventDefault()
            event.stopPropagation()
            onOpenSpaceContextMenu?.(space.id, { x: event.clientX, y: event.clientY })
          }}
          onClick={() => {
            activateSpace(space.id)
            cancelSpaceRename()
          }}
        >
          {space.labelColor ? (
            <span
              className="cove-label-dot cove-label-dot--solid"
              data-cove-label-color={space.labelColor}
              aria-hidden="true"
            />
          ) : null}
          <span className="workspace-space-switcher__item-label">{space.name}</span>
        </button>
      ))}
    </div>
  )
}
