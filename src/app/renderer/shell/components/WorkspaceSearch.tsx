import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import {
  MAX_WORKSPACE_SEARCH_PANEL_WIDTH,
  MIN_WORKSPACE_SEARCH_PANEL_WIDTH,
} from '@contexts/settings/domain/agentSettings'
import type { GitHubPullRequestSummary, GitWorktreeInfo } from '@shared/contracts/dto'
import { searchWorkspace } from '../utils/workspaceSearch'
import { WorkspaceSearchResultItem } from './WorkspaceSearchResultItem'
import {
  flattenWorkspaceSearchSections,
  toWorkspaceSearchSections,
} from './workspaceSearchSections'

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
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<{
    spaces: boolean
    tasks: boolean
    notes: boolean
  }>({
    spaces: true,
    tasks: true,
    notes: true,
  })
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [draftPanelWidth, setDraftPanelWidth] = useState(panelWidth)
  const panelWidthRef = useRef(panelWidth)
  const draftPanelWidthRef = useRef(panelWidth)
  const panelRef = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const interactionModeRef = useRef<'keyboard' | 'pointer'>('keyboard')
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

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
      activeWorkspace?.path,
      activeWorkspace?.spaces,
      pullRequestsByBranch,
      query,
      worktreeInfoByPath,
    ],
  )
  const filteredHits = useMemo(() => {
    if (kindFilter.spaces && kindFilter.tasks && kindFilter.notes) {
      return hits
    }

    return hits.filter(hit => {
      if (hit.kind === 'space') {
        return kindFilter.spaces
      }

      if (hit.kind === 'task') {
        return kindFilter.tasks
      }

      return kindFilter.notes
    })
  }, [hits, kindFilter.notes, kindFilter.spaces, kindFilter.tasks])
  const sections = useMemo(
    () =>
      toWorkspaceSearchSections({
        hits: filteredHits,
        t,
        onSelectNode,
        onSelectSpace,
      }),
    [filteredHits, onSelectNode, onSelectSpace, t],
  )
  const flattenedItems = useMemo(() => flattenWorkspaceSearchSections(sections), [sections])
  const selectedItem = useMemo(() => {
    if (flattenedItems.length === 0) {
      return null
    }

    if (activeItemId) {
      return flattenedItems.find(item => item.id === activeItemId) ?? flattenedItems[0]
    }

    return flattenedItems[0]
  }, [activeItemId, flattenedItems])

  useEffect(() => {
    panelWidthRef.current = panelWidth
  }, [panelWidth])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    setQuery('')
    setActiveItemId(null)
    setDraftPanelWidth(panelWidthRef.current)

    window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)

    return () => {
      const focusTarget = restoreFocusRef.current
      restoreFocusRef.current = null
      if (focusTarget && document.contains(focusTarget)) {
        window.setTimeout(() => {
          focusTarget.focus()
        }, 0)
      }
    }
  }, [isOpen])

  useEffect(() => {
    if (resizeStateRef.current) {
      return
    }

    setDraftPanelWidth(panelWidth)
  }, [panelWidth])

  useEffect(() => {
    draftPanelWidthRef.current = draftPanelWidth
  }, [draftPanelWidth])

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
      resizeCleanupRef.current = null
      resizeStateRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }

      const panel = panelRef.current
      if (panel && panel.contains(target)) {
        return
      }

      restoreFocusRef.current = target
    }

    document.addEventListener('focusin', handleFocusIn)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !selectedItem) {
      return
    }

    if (interactionModeRef.current !== 'keyboard') {
      return
    }

    const target = itemRefs.current.get(selectedItem.id)
    target?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, selectedItem])

  if (!isOpen) {
    return null
  }

  const clampPanelWidth = (value: number): number => {
    return Math.max(
      MIN_WORKSPACE_SEARCH_PANEL_WIDTH,
      Math.min(MAX_WORKSPACE_SEARCH_PANEL_WIDTH, Math.round(value)),
    )
  }

  return (
    <aside
      className="workspace-search-panel"
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={t('workspaceSearch.title')}
      data-testid="workspace-search"
      style={{
        width: clampPanelWidth(draftPanelWidth),
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape') {
          return
        }

        interactionModeRef.current = 'keyboard'
        event.preventDefault()
        onClose()
      }}
    >
      <div
        className="workspace-search-panel__resize-handle"
        data-testid="workspace-search-resize-handle"
        onPointerDown={event => {
          if (event.button !== 0) {
            return
          }

          event.preventDefault()
          event.stopPropagation()

          resizeStateRef.current = {
            startX: event.clientX,
            startWidth: clampPanelWidth(draftPanelWidth),
          }

          document.body.style.cursor = 'ew-resize'
          document.body.style.userSelect = 'none'

          const handlePointerMove = (moveEvent: PointerEvent): void => {
            const resizeState = resizeStateRef.current
            if (!resizeState) {
              return
            }

            const deltaX = resizeState.startX - moveEvent.clientX
            const nextWidth = clampPanelWidth(resizeState.startWidth + deltaX)
            draftPanelWidthRef.current = nextWidth
            setDraftPanelWidth(nextWidth)
          }

          const handlePointerUp = (): void => {
            const resizeState = resizeStateRef.current
            resizeStateRef.current = null
            resizeCleanupRef.current?.()
            resizeCleanupRef.current = null

            if (resizeState) {
              onPanelWidthChange(clampPanelWidth(draftPanelWidthRef.current))
            }
          }

          resizeCleanupRef.current = () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
          }

          window.addEventListener('pointermove', handlePointerMove)
          window.addEventListener('pointerup', handlePointerUp, { once: true })
        }}
      />

      <div className="command-center__input-row">
        <Search aria-hidden="true" size={16} className="command-center__search-icon" />
        <input
          ref={inputRef}
          className="command-center__input"
          value={query}
          placeholder={t('workspaceSearch.placeholder')}
          data-testid="workspace-search-input"
          onChange={event => {
            setQuery(event.target.value)
            setActiveItemId(null)
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              interactionModeRef.current = 'keyboard'
              event.preventDefault()
              onClose()
              return
            }

            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              interactionModeRef.current = 'keyboard'
              event.preventDefault()
              if (flattenedItems.length === 0) {
                return
              }

              const currentIndex = selectedItem
                ? flattenedItems.findIndex(item => item.id === selectedItem.id)
                : -1
              const delta = event.key === 'ArrowDown' ? 1 : -1
              const nextIndex =
                currentIndex === -1
                  ? 0
                  : (currentIndex + delta + flattenedItems.length) % flattenedItems.length
              setActiveItemId(flattenedItems[nextIndex].id)
              return
            }

            if (event.key === 'Enter') {
              if (!selectedItem) {
                return
              }
              interactionModeRef.current = 'keyboard'
              event.preventDefault()
              selectedItem.onSelect()
              return
            }
          }}
        />

        <div className="command-center__meta" aria-hidden="true">
          <span className="command-center__meta-item">{t('workspaceSearch.metaEsc')}</span>
        </div>

        <button
          type="button"
          className="workspace-search-panel__close"
          aria-label={t('common.close')}
          onClick={() => {
            onClose()
          }}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>

      <div
        className="workspace-search-panel__filters"
        role="group"
        aria-label={t('workspaceSearch.filters.label')}
      >
        <button
          type="button"
          className={`workspace-search-panel__filter ${kindFilter.spaces && kindFilter.tasks && kindFilter.notes ? 'workspace-search-panel__filter--active' : ''}`.trim()}
          data-testid="workspace-search-filter-all"
          aria-pressed={kindFilter.spaces && kindFilter.tasks && kindFilter.notes}
          onClick={() => {
            setActiveItemId(null)
            setKindFilter({
              spaces: true,
              tasks: true,
              notes: true,
            })
          }}
        >
          {t('workspaceSearch.filters.all')}
        </button>
        <button
          type="button"
          className={`workspace-search-panel__filter ${kindFilter.spaces ? 'workspace-search-panel__filter--active' : ''}`.trim()}
          data-testid="workspace-search-filter-spaces"
          aria-pressed={kindFilter.spaces}
          onClick={() => {
            setActiveItemId(null)
            setKindFilter(prev => {
              const next = {
                ...prev,
                spaces: !prev.spaces,
              }
              if (!next.spaces && !next.tasks && !next.notes) {
                return prev
              }

              return next
            })
          }}
        >
          {t('workspaceSearch.sections.spaces')}
        </button>
        <button
          type="button"
          className={`workspace-search-panel__filter ${kindFilter.tasks ? 'workspace-search-panel__filter--active' : ''}`.trim()}
          data-testid="workspace-search-filter-tasks"
          aria-pressed={kindFilter.tasks}
          onClick={() => {
            setActiveItemId(null)
            setKindFilter(prev => {
              const next = {
                ...prev,
                tasks: !prev.tasks,
              }
              if (!next.spaces && !next.tasks && !next.notes) {
                return prev
              }

              return next
            })
          }}
        >
          {t('workspaceSearch.sections.tasks')}
        </button>
        <button
          type="button"
          className={`workspace-search-panel__filter ${kindFilter.notes ? 'workspace-search-panel__filter--active' : ''}`.trim()}
          data-testid="workspace-search-filter-notes"
          aria-pressed={kindFilter.notes}
          onClick={() => {
            setActiveItemId(null)
            setKindFilter(prev => {
              const next = {
                ...prev,
                notes: !prev.notes,
              }
              if (!next.spaces && !next.tasks && !next.notes) {
                return prev
              }

              return next
            })
          }}
        >
          {t('workspaceSearch.sections.notes')}
        </button>
      </div>

      <div
        className="command-center__results"
        role="listbox"
        onMouseMove={() => {
          interactionModeRef.current = 'pointer'
        }}
      >
        {sections.length === 0 ? (
          <div className="command-center__empty">{t('workspaceSearch.empty')}</div>
        ) : null}

        {sections.map(section => (
          <div key={section.id} className="command-center__section">
            <div className="command-center__section-label">{section.label}</div>
            <div className="command-center__section-items">
              {section.items.map(item => {
                const isSelected = selectedItem?.id === item.id
                return (
                  <WorkspaceSearchResultItem
                    key={item.id}
                    ref={element => {
                      if (!element) {
                        itemRefs.current.delete(item.id)
                        return
                      }
                      itemRefs.current.set(item.id, element)
                    }}
                    item={item}
                    isSelected={isSelected}
                    onMouseEnter={() => {
                      if (interactionModeRef.current !== 'pointer') {
                        return
                      }
                      setActiveItemId(item.id)
                    }}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
