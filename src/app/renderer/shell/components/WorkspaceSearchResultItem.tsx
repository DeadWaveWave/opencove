import { forwardRef } from 'react'
import { GitBranch, GitPullRequest, Scan } from 'lucide-react'
import type { WorkspaceSearchItem } from './workspaceSearchSections'

export const WorkspaceSearchResultItem = forwardRef<
  HTMLButtonElement,
  {
    item: WorkspaceSearchItem
    optionId: string
    isSelected: boolean
    onMouseEnter: () => void
  }
>(function WorkspaceSearchResultItem({ item, optionId, isSelected, onMouseEnter }, ref) {
  return (
    <button
      ref={ref}
      id={optionId}
      type="button"
      className={`workspace-search-panel__item${isSelected ? ' workspace-search-panel__item--selected' : ''}`}
      data-testid={`workspace-search-item-${item.id}`}
      data-cove-label-color={item.labelColor ?? undefined}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      onMouseDown={event => event.preventDefault()}
      onMouseEnter={onMouseEnter}
      onClick={item.onSelect}
    >
      <span className="workspace-search-panel__item-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="workspace-search-panel__item-text">
        <span className="workspace-search-panel__item-title">{item.title}</span>
        {item.subtitle ? (
          <span className="workspace-search-panel__item-subtitle">{item.subtitle}</span>
        ) : null}
        {item.metadata.length > 0 ? (
          <span className="workspace-search-panel__metadata">
            {item.metadata.map(metadata => {
              const Icon =
                metadata.kind === 'space'
                  ? Scan
                  : metadata.kind === 'branch'
                    ? GitBranch
                    : GitPullRequest
              return (
                <span
                  key={`${metadata.kind}-${metadata.value}`}
                  className={`workspace-search-panel__meta workspace-search-panel__meta--${metadata.kind}`}
                  title={metadata.title ?? metadata.value}
                >
                  <Icon size={12} aria-hidden="true" />
                  <span>{metadata.value}</span>
                </span>
              )
            })}
          </span>
        ) : null}
      </span>
    </button>
  )
})
