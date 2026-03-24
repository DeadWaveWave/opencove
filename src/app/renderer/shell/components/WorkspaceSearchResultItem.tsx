import React, { forwardRef } from 'react'
import type { WorkspaceSearchItem, WorkspaceSearchPill } from './workspaceSearchSections'

export const WorkspaceSearchResultItem = forwardRef<
  HTMLButtonElement,
  {
    item: WorkspaceSearchItem
    isSelected: boolean
    onMouseEnter: () => void
  }
>(function WorkspaceSearchResultItem({ item, isSelected, onMouseEnter }, ref) {
  return (
    <button
      ref={ref}
      key={item.id}
      type="button"
      className={`command-center__item ${isSelected ? 'command-center__item--selected' : ''}`}
      data-testid={`workspace-search-item-${item.id}`}
      role="option"
      aria-selected={isSelected}
      onMouseEnter={onMouseEnter}
      onClick={() => {
        item.onSelect()
      }}
    >
      <span className="command-center__item-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="command-center__item-text">
        <span className="workspace-search-panel__item-title-row">
          <span className="workspace-search-panel__item-title-main">
            {item.labelColor ? (
              <span
                className="cove-label-dot cove-label-dot--solid"
                data-cove-label-color={item.labelColor}
                aria-hidden="true"
              />
            ) : null}
            <span className="command-center__item-title">{item.title}</span>
          </span>

          {item.pills.length > 0 ? (
            <span className="workspace-search-panel__pills">
              {item.pills.map(pill => renderPill(item.id, pill))}
            </span>
          ) : null}
        </span>
        {item.subtitle ? (
          <span className="command-center__item-subtitle">{item.subtitle}</span>
        ) : null}
      </span>
    </button>
  )
})

function renderPill(itemId: string, pill: WorkspaceSearchPill): React.JSX.Element {
  if (pill.kind === 'space') {
    return (
      <span
        key={`${itemId}-pill-space-${pill.value}`}
        className="workspace-search-panel__pill workspace-search-panel__pill--space"
        data-cove-label-color={pill.color ?? undefined}
      >
        {pill.color ? (
          <span
            className="cove-label-dot cove-label-dot--solid"
            data-cove-label-color={pill.color}
            aria-hidden="true"
          />
        ) : null}
        <span className="workspace-search-panel__pill-value">{pill.value}</span>
      </span>
    )
  }

  if (pill.kind === 'branch') {
    return (
      <span
        key={`${itemId}-pill-branch-${pill.value}`}
        className="workspace-search-panel__pill workspace-search-panel__pill--branch"
        data-cove-label-color="blue"
        title={pill.title}
      >
        <span className="workspace-search-panel__pill-kind">{pill.label}</span>
        <span className="workspace-search-panel__pill-value">{pill.value}</span>
      </span>
    )
  }

  return (
    <span
      key={`${itemId}-pill-pr-${pill.value}`}
      className="workspace-search-panel__pill workspace-search-panel__pill--pr"
      data-cove-label-color="purple"
      title={pill.title}
    >
      <span className="workspace-search-panel__pill-kind">{pill.label}</span>
      <span className="workspace-search-panel__pill-value">{pill.value}</span>
    </span>
  )
}
