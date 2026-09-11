import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { useCompactViewport } from '@app/renderer/components/useCompactViewport'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { GitHubPullRequestSummary, GitWorktreeInfo } from '@shared/contracts/dto'
import { searchWorkspace } from '../utils/workspaceSearch'
import { WorkspaceSearchResultItem } from './WorkspaceSearchResultItem'
import { useWorkspaceSearchSurface } from './useWorkspaceSearchSurface'
import {
  flattenWorkspaceSearchSections,
  toWorkspaceSearchSections,
} from './workspaceSearchSections'

type Category = 'spaces' | 'tasks' | 'notes'

export function WorkspaceSearch({
  isOpen,
  activeWorkspace,
  onClose,
  onSelectNode,
  onSelectSpace,
  panelWidth,
  onPanelWidthChange,
  worktreeInfoByPath,
  pullRequestsByBranch,
}: {
  isOpen: boolean
  activeWorkspace: WorkspaceState | null
  onClose: () => void
  onSelectNode: (nodeId: string) => void
  onSelectSpace: (spaceId: string) => void
  panelWidth: number
  onPanelWidthChange: (nextWidth: number) => void
  worktreeInfoByPath: Map<string, GitWorktreeInfo> | null
  pullRequestsByBranch: Record<string, GitHubPullRequestSummary | null> | null
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const isCompact = useCompactViewport()
  const id = useId()
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<Record<Category, boolean>>({
    spaces: true,
    tasks: true,
    notes: true,
  })
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const interactionModeRef = useRef<'keyboard' | 'pointer'>('keyboard')
  const surface = useWorkspaceSearchSurface({ isOpen, isCompact, panelWidth, onPanelWidthChange })
  const selectNode = useCallback(
    (nodeId: string): void => {
      if (isCompact) {
        onClose()
      }
      onSelectNode(nodeId)
    },
    [isCompact, onClose, onSelectNode],
  )
  const selectSpace = useCallback(
    (spaceId: string): void => {
      if (isCompact) {
        onClose()
      }
      onSelectSpace(spaceId)
    },
    [isCompact, onClose, onSelectSpace],
  )
  const hits = useMemo(
    () =>
      searchWorkspace({
        nodes: activeWorkspace?.nodes ?? [],
        spaces: activeWorkspace?.spaces ?? [],
        query,
        workspacePath: activeWorkspace?.path ?? '',
        worktreeInfoByPath,
        pullRequestsByBranch,
      }),
    [
      activeWorkspace?.nodes,
      activeWorkspace?.spaces,
      activeWorkspace?.path,
      query,
      worktreeInfoByPath,
      pullRequestsByBranch,
    ],
  )
  const sections = useMemo(
    () =>
      toWorkspaceSearchSections({
        hits: hits.filter(
          hit =>
            kindFilter[hit.kind === 'space' ? 'spaces' : hit.kind === 'task' ? 'tasks' : 'notes'],
        ),
        t,
        onSelectNode: selectNode,
        onSelectSpace: selectSpace,
      }),
    [hits, kindFilter, t, selectNode, selectSpace],
  )
  const items = useMemo(() => flattenWorkspaceSearchSections(sections), [sections])
  const selectedItem = items.find(item => item.id === activeItemId) ?? items[0] ?? null
  const optionId = (itemId: string): string => `${id}-option-${itemId}`

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveItemId(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !selectedItem || interactionModeRef.current !== 'keyboard') {
      return
    }
    const item = itemRefs.current.get(selectedItem.id)
    const results = resultsRef.current
    if (!item || !results) {
      return
    }
    const row = item.getBoundingClientRect()
    const viewport = results.getBoundingClientRect()
    if (row.top < viewport.top) {
      results.scrollTop += row.top - viewport.top
    } else if (row.bottom > viewport.bottom) {
      results.scrollTop += row.bottom - viewport.bottom
    }
  }, [isOpen, selectedItem])

  if (!isOpen) {
    return null
  }

  const content = (
    <>
      {!isCompact ? (
        <div
          className="workspace-search-panel__resize-handle"
          data-testid="workspace-search-resize-handle"
          onPointerDown={surface.onResizeStart}
        />
      ) : null}
      <header className="workspace-search-panel__header">
        <Search size={15} aria-hidden="true" />
        <h2 id={`${id}-title`}>{t('workspaceSearch.title')}</h2>
        {activeWorkspace ? (
          <span className="workspace-search-panel__project" title={activeWorkspace.name}>
            {activeWorkspace.name}
          </span>
        ) : null}
        <IconButton
          ref={surface.closeRef}
          label={t('common.close')}
          className="workspace-search-panel__close"
          data-testid="workspace-search-close"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="workspace-search-panel__search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={surface.inputRef}
          className="workspace-search-panel__input"
          aria-label={t('workspaceSearch.title')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-results`}
          aria-activedescendant={selectedItem ? optionId(selectedItem.id) : undefined}
          value={query}
          placeholder={t('workspaceSearch.placeholder')}
          data-testid="workspace-search-input"
          onChange={event => {
            setQuery(event.target.value)
            setActiveItemId(null)
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
              return
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              interactionModeRef.current = 'keyboard'
              if (items.length === 0) {
                return
              }
              const index = items.findIndex(item => item.id === selectedItem?.id)
              const delta = event.key === 'ArrowDown' ? 1 : -1
              setActiveItemId(items[(index + delta + items.length) % items.length].id)
            } else if (event.key === 'Enter' && selectedItem) {
              event.preventDefault()
              selectedItem.onSelect()
            }
          }}
        />
      </div>
      <div
        className="workspace-search-panel__filters"
        role="group"
        aria-label={t('workspaceSearch.filters.label')}
      >
        <button
          type="button"
          className="workspace-search-panel__filter"
          data-testid="workspace-search-filter-all"
          aria-pressed={kindFilter.spaces && kindFilter.tasks && kindFilter.notes}
          onClick={() => {
            setActiveItemId(null)
            setKindFilter({ spaces: true, tasks: true, notes: true })
          }}
        >
          {t('workspaceSearch.filters.all')}
        </button>
        {(['spaces', 'tasks', 'notes'] as const).map(category => (
          <button
            key={category}
            type="button"
            className="workspace-search-panel__filter"
            data-testid={`workspace-search-filter-${category}`}
            aria-pressed={kindFilter[category]}
            onClick={() => {
              setActiveItemId(null)
              setKindFilter(previous => {
                const next = { ...previous, [category]: !previous[category] }
                return Object.values(next).some(Boolean) ? next : previous
              })
            }}
          >
            {t(`workspaceSearch.sections.${category}`)}
          </button>
        ))}
      </div>
      <div
        ref={resultsRef}
        id={`${id}-results`}
        className="workspace-search-panel__results"
        role="listbox"
        aria-label={t('workspaceSearch.title')}
        onMouseMove={() => {
          interactionModeRef.current = 'pointer'
        }}
      >
        {sections.length === 0 ? (
          <div className="workspace-search-panel__empty">{t('workspaceSearch.empty')}</div>
        ) : null}
        {sections.map(section => (
          <div
            key={section.id}
            className="workspace-search-panel__section"
            role="group"
            aria-labelledby={`${id}-${section.id}`}
          >
            <h3 className="workspace-search-panel__section-label" id={`${id}-${section.id}`}>
              {section.label}
              <span>{section.items.length}</span>
            </h3>
            {section.items.map(item => (
              <WorkspaceSearchResultItem
                key={item.id}
                ref={element => {
                  if (element) {
                    itemRefs.current.set(item.id, element)
                  } else {
                    itemRefs.current.delete(item.id)
                  }
                }}
                item={item}
                optionId={optionId(item.id)}
                isSelected={selectedItem?.id === item.id}
                onMouseEnter={() => {
                  if (interactionModeRef.current === 'pointer') {
                    setActiveItemId(item.id)
                  }
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  )

  if (isCompact) {
    return (
      <Dialog
        ref={surface.panelRef}
        open
        onDismiss={onClose}
        className="workspace-search-panel workspace-search-panel--compact"
        backdropClassName="workspace-search-backdrop"
        backdropTestId="workspace-search-backdrop"
        data-testid="workspace-search"
        aria-labelledby={`${id}-title`}
        initialFocusRef={surface.closeRef}
        returnFocus={surface.returnFocusRef}
        fallbackReturnFocusSelector="[data-testid='app-header-command-center']"
        inertRootSelector=".app-shell"
      >
        {content}
      </Dialog>
    )
  }

  return (
    <div
      ref={surface.panelRef}
      className="workspace-search-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      data-testid="workspace-search"
      style={{ width: surface.width }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      {content}
    </div>
  )
}
