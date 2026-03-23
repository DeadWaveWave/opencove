import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, PanelLeftClose, PanelLeftOpen, Search, Settings, SquareDashed } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  WorkspaceSpaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'

type CommandCenterItem = {
  id: string
  title: string
  subtitle?: string
  icon: React.JSX.Element
  onSelect: () => void
}

type CommandCenterSection = {
  id: string
  label: string
  items: CommandCenterItem[]
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function fuzzyScore(candidate: string, query: string): number | null {
  if (!query) {
    return 0
  }

  const haystack = candidate.toLowerCase()
  let lastIndex = -1
  let score = 0

  for (const needleChar of query) {
    const nextIndex = haystack.indexOf(needleChar, lastIndex + 1)
    if (nextIndex === -1) {
      return null
    }

    const gap = nextIndex - lastIndex - 1
    score += gap === 0 ? 15 : Math.max(2, 12 - gap)
    lastIndex = nextIndex
  }

  if (haystack.startsWith(query)) {
    score += 20
  } else if (haystack.includes(query)) {
    score += 12
  }

  return score
}

function filterAndRank(items: CommandCenterItem[], query: string): CommandCenterItem[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return items
  }

  const ranked = items
    .map(item => {
      const text = [item.title, item.subtitle].filter(Boolean).join(' ')
      const score = fuzzyScore(text, normalizedQuery)
      return score === null ? null : { item, score }
    })
    .filter((entry): entry is { item: CommandCenterItem; score: number } => entry !== null)
    .sort((left, right) => right.score - left.score)

  return ranked.map(entry => entry.item)
}

function flattenSections(sections: CommandCenterSection[]): CommandCenterItem[] {
  return sections.flatMap(section => section.items)
}

function resolveActiveSpace(activeWorkspace: WorkspaceState | null): {
  space: WorkspaceSpaceState | null
  index: number
} {
  if (!activeWorkspace || !activeWorkspace.activeSpaceId) {
    return { space: null, index: -1 }
  }

  const index = activeWorkspace.spaces.findIndex(
    space => space.id === activeWorkspace.activeSpaceId,
  )
  return {
    space: index >= 0 ? activeWorkspace.spaces[index] : null,
    index,
  }
}

export function CommandCenter({
  isOpen,
  activeWorkspace,
  workspaces,
  isPrimarySidebarCollapsed,
  onClose,
  onOpenSettings,
  onTogglePrimarySidebar,
  onAddWorkspace,
  onSelectWorkspace,
  onSelectSpace,
}: {
  isOpen: boolean
  activeWorkspace: WorkspaceState | null
  workspaces: WorkspaceState[]
  isPrimarySidebarCollapsed: boolean
  onClose: () => void
  onOpenSettings: () => void
  onTogglePrimarySidebar: () => void
  onAddWorkspace: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (spaceId: string | null) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const interactionModeRef = useRef<'keyboard' | 'pointer'>('keyboard')

  const { space: activeSpace } = useMemo(
    () => resolveActiveSpace(activeWorkspace),
    [activeWorkspace],
  )

  const baseSections = useMemo<CommandCenterSection[]>(() => {
    const commandItems: CommandCenterItem[] = [
      {
        id: 'command:settings',
        title: t('commandCenter.commands.openSettings'),
        subtitle: t('commandCenter.commands.openSettingsHint'),
        icon: <Settings aria-hidden="true" size={16} />,
        onSelect: () => {
          onOpenSettings()
        },
      },
      {
        id: 'command:toggle-primary-sidebar',
        title: isPrimarySidebarCollapsed
          ? t('commandCenter.commands.showPrimarySidebar')
          : t('commandCenter.commands.hidePrimarySidebar'),
        subtitle: t('commandCenter.commands.togglePrimarySidebarHint'),
        icon: isPrimarySidebarCollapsed ? (
          <PanelLeftOpen aria-hidden="true" size={16} />
        ) : (
          <PanelLeftClose aria-hidden="true" size={16} />
        ),
        onSelect: () => {
          onTogglePrimarySidebar()
        },
      },
      {
        id: 'command:add-project',
        title: t('commandCenter.commands.addProject'),
        subtitle: t('commandCenter.commands.addProjectHint'),
        icon: <Folder aria-hidden="true" size={16} />,
        onSelect: () => {
          onAddWorkspace()
        },
      },
    ]

    const projectItems: CommandCenterItem[] = workspaces.map(workspace => ({
      id: `workspace:${workspace.id}`,
      title: workspace.name,
      subtitle: workspace.path,
      icon: <Folder aria-hidden="true" size={16} />,
      onSelect: () => {
        onSelectWorkspace(workspace.id)
      },
    }))

    const spaceItems: CommandCenterItem[] =
      activeWorkspace?.spaces.map(space => ({
        id: `space:${space.id}`,
        title: space.name,
        subtitle: space.directoryPath,
        icon: <SquareDashed aria-hidden="true" size={16} />,
        onSelect: () => {
          onSelectSpace(space.id)
        },
      })) ?? []

    const sections: CommandCenterSection[] = []

    sections.push({
      id: 'commands',
      label: t('commandCenter.sections.commands'),
      items: commandItems,
    })

    if (spaceItems.length > 0) {
      sections.push({
        id: 'spaces',
        label: t('commandCenter.sections.spaces'),
        items: spaceItems,
      })
    }

    sections.push({
      id: 'projects',
      label: t('commandCenter.sections.projects'),
      items: projectItems,
    })

    return sections
  }, [
    t,
    activeWorkspace,
    isPrimarySidebarCollapsed,
    onAddWorkspace,
    onOpenSettings,
    onSelectSpace,
    onSelectWorkspace,
    onTogglePrimarySidebar,
    workspaces,
  ])

  const sections = useMemo<CommandCenterSection[]>(() => {
    const rankedSections = baseSections
      .map(section => {
        const rankedItems = filterAndRank(section.items, query)
        return rankedItems.length === 0 ? null : { ...section, items: rankedItems }
      })
      .filter((section): section is CommandCenterSection => section !== null)

    return rankedSections
  }, [baseSections, query])

  const flattenedItems = useMemo(() => flattenSections(sections), [sections])
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
    if (!isOpen) {
      return
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    setQuery('')
    setActiveItemId(null)

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

  return (
    <div
      className="command-center-backdrop"
      data-testid="command-center-backdrop"
      onMouseDown={event => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        className="command-center"
        role="dialog"
        aria-modal="true"
        aria-label={t('commandCenter.title')}
        data-testid="command-center"
        onMouseDown={event => {
          event.stopPropagation()
        }}
      >
        <div className="command-center__input-row">
          <Search aria-hidden="true" size={16} className="command-center__search-icon" />
          <input
            ref={inputRef}
            className="command-center__input"
            value={query}
            placeholder={t('commandCenter.placeholder')}
            data-testid="command-center-input"
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
                onClose()
              }
            }}
          />

          <div className="command-center__meta" aria-hidden="true">
            {activeSpace ? (
              <span className="command-center__meta-item">
                {t('commandCenter.activeSpace', { name: activeSpace.name })}
              </span>
            ) : null}
            <span className="command-center__meta-item">{t('commandCenter.metaEsc')}</span>
          </div>
        </div>

        <div
          className="command-center__results"
          role="listbox"
          onMouseMove={() => {
            interactionModeRef.current = 'pointer'
          }}
        >
          {sections.length === 0 ? (
            <div className="command-center__empty">{t('commandCenter.empty')}</div>
          ) : null}

          {sections.map(section => (
            <div key={section.id} className="command-center__section">
              <div className="command-center__section-label">{section.label}</div>
              <div className="command-center__section-items">
                {section.items.map(item => {
                  const isSelected = selectedItem?.id === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`command-center__item ${isSelected ? 'command-center__item--selected' : ''}`}
                      data-testid={`command-center-item-${item.id}`}
                      ref={element => {
                        if (!element) {
                          itemRefs.current.delete(item.id)
                          return
                        }
                        itemRefs.current.set(item.id, element)
                      }}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => {
                        if (interactionModeRef.current !== 'pointer') {
                          return
                        }
                        setActiveItemId(item.id)
                      }}
                      onClick={() => {
                        item.onSelect()
                        onClose()
                      }}
                    >
                      <span className="command-center__item-icon" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="command-center__item-text">
                        <span className="command-center__item-title">{item.title}</span>
                        {item.subtitle ? (
                          <span className="command-center__item-subtitle">{item.subtitle}</span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
