import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  FolderPlus,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Scan,
  Server,
  X,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { useWorkspaceMountDetails } from '../hooks/useWorkspaceMountSummaries'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { useCompactViewport } from '@app/renderer/components/useCompactViewport'
import { ProjectIcon } from './ProjectIcon'
import {
  normalizeQuery,
  rankCommandSections,
  type CommandCenterItem,
  type CommandCenterSection,
} from './commandCenterModel'
import { usePluginCommands } from '@contexts/plugins/presentation/renderer/usePluginCommands'
import { PluginIcon } from '@contexts/plugins/presentation/renderer/PluginIcon'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'

export function CommandCenter({
  isOpen,
  activeWorkspace,
  workspaces,
  isPrimarySidebarCollapsed,
  onClose,
  onOpenSettings,
  onOpenWorkspaceSearch,
  onOpenSpaceArchives,
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
  onOpenWorkspaceSearch: () => void
  onOpenSpaceArchives: () => void
  onTogglePrimarySidebar: () => void
  onAddWorkspace: () => void
  onSelectWorkspace: (workspaceId: string) => void
  onSelectSpace: (spaceId: string | null) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const compact = useCompactViewport()
  const resultsId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const interactionModeRef = useRef<'keyboard' | 'pointer'>('keyboard')
  const mountDetails = useWorkspaceMountDetails({ workspaces })

  const activeSpace =
    activeWorkspace?.spaces.find(space => space.id === activeWorkspace.activeSpaceId) ?? null

  const pluginCommands = usePluginCommands(
    {
      surface: 'commandCenter',
      ...(activeWorkspace ? { projectId: activeWorkspace.id } : {}),
      ...(activeSpace ? { spaceId: activeSpace.id } : {}),
    },
    isOpen,
  )

  const baseSections = useMemo<CommandCenterSection[]>(() => {
    const commandItems: CommandCenterItem[] = [
      ...(activeWorkspace
        ? [
            {
              id: 'command:workspace-search',
              title: t('commandCenter.commands.searchWorkspace'),
              icon: <Search aria-hidden="true" size={16} />,
              onSelect: onOpenWorkspaceSearch,
            },
          ]
        : []),
      {
        id: 'command:settings',
        title: t('commandCenter.commands.openSettings'),
        keywords: t('commandCenter.commands.openSettingsHint'),
        icon: <Settings aria-hidden="true" size={16} />,
        onSelect: () => {
          onOpenSettings()
        },
      },
      ...(activeWorkspace
        ? [
            {
              id: 'command:space-archives',
              title: t('commandCenter.commands.spaceArchives'),
              keywords: t('commandCenter.commands.spaceArchivesHint'),
              icon: <Package aria-hidden="true" size={16} />,
              onSelect: () => {
                onOpenSpaceArchives()
              },
            },
          ]
        : []),
      {
        id: 'command:toggle-primary-sidebar',
        title: isPrimarySidebarCollapsed
          ? t('commandCenter.commands.showPrimarySidebar')
          : t('commandCenter.commands.hidePrimarySidebar'),
        keywords: t('commandCenter.commands.togglePrimarySidebarHint'),
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
        keywords: t('commandCenter.commands.addProjectHint'),
        icon: <FolderPlus aria-hidden="true" size={16} />,
        onSelect: () => {
          onAddWorkspace()
        },
      },
    ]

    const projectItems: CommandCenterItem[] = workspaces.map(workspace => ({
      id: `workspace:${workspace.id}`,
      title: workspace.name,
      keywords: [workspace.path, mountDetails[workspace.id]?.summary].filter(Boolean).join(' '),
      icon: (
        <ProjectIcon iconId={workspace.iconId} isExpanded={workspace.id === activeWorkspace?.id} />
      ),
      remoteLabel: mountDetails[workspace.id]?.remote?.displayName,
      isCurrent: workspace.id === activeWorkspace?.id,
      showCurrentMarker: workspace.id === activeWorkspace?.id,
      onSelect: () => {
        onSelectWorkspace(workspace.id)
      },
    }))

    const spaceItems: CommandCenterItem[] =
      activeWorkspace?.spaces
        .filter(space => !space.parentSpaceId)
        .map(space => ({
          id: `space:${space.id}`,
          title: space.name,
          icon: <Scan aria-hidden="true" size={16} />,
          labelColor: space.labelColor,
          isCurrent: space.id === activeSpace?.id,
          onSelect: () => onSelectSpace(space.id),
        })) ?? []

    const sections: CommandCenterSection[] = []
    if (pluginCommands.items.length) {
      sections.push({
        id: 'plugins',
        label: t('pluginHostExtensions.commands'),
        items: pluginCommands.items.map(item => ({
          id: item.id,
          title: item.title,
          keywords: item.command.description,
          icon: <PluginIcon pluginId={item.plugin.id} />,
          onSelect: () => {
            void pluginCommands.run(item)
          },
        })),
      })
    }

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
    pluginCommands,
    t,
    activeWorkspace,
    isPrimarySidebarCollapsed,
    mountDetails,
    activeSpace?.id,
    onOpenWorkspaceSearch,
    onAddWorkspace,
    onOpenSettings,
    onOpenSpaceArchives,
    onSelectSpace,
    onSelectWorkspace,
    onTogglePrimarySidebar,
    workspaces,
  ])

  const sections = useMemo(() => rankCommandSections(baseSections, query), [baseSections, query])
  const flattenedItems = useMemo(() => sections.flatMap(section => section.items), [sections])
  const selectedItem = useMemo(() => {
    if (flattenedItems.length === 0) {
      return null
    }

    if (activeItemId) {
      return flattenedItems.find(item => item.id === activeItemId) ?? flattenedItems[0]
    }

    return flattenedItems[0]
  }, [activeItemId, flattenedItems])

  useLayoutEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveItemId(null)
      interactionModeRef.current = 'keyboard'
    }
  }, [isOpen])

  // Mobile dismissal returns to navigation without reopening a terminal's soft keyboard.
  returnFocusRef.current = compact
    ? document.querySelector<HTMLElement>('[data-testid="app-header-command-center"]')
    : null

  useEffect(() => {
    const list = resultsRef.current
    const item = selectedItem ? itemRefs.current.get(selectedItem.id) : null
    if (!isOpen || !list || !item || interactionModeRef.current !== 'keyboard') {
      return
    }
    const listRect = list.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    if (itemRect.top < listRect.top) {
      list.scrollTop -= listRect.top - itemRect.top
    } else if (itemRect.bottom > listRect.bottom) {
      list.scrollTop += itemRect.bottom - listRect.bottom
    }
  }, [isOpen, selectedItem])

  const activateItem = (item: CommandCenterItem): void => {
    onClose()
    item.onSelect()
  }

  if (!isOpen) {
    return null
  }

  return (
    <Dialog
      open={isOpen}
      onDismiss={onClose}
      className="command-center"
      backdropClassName="command-center-backdrop"
      backdropTestId="command-center-backdrop"
      data-testid="command-center"
      aria-label={t('commandCenter.title')}
      initialFocusRef={compact ? closeRef : inputRef}
      returnFocus={returnFocusRef}
      fallbackReturnFocusSelector='[data-testid="app-header-command-center"]'
      inertRootSelector=".app-shell"
    >
      <div className="command-center__input-row">
        <Search aria-hidden="true" size={16} className="command-center__search-icon" />
        <input
          ref={inputRef}
          className="command-center__input"
          value={query}
          aria-label={t('commandCenter.title')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={resultsId}
          aria-activedescendant={selectedItem ? `${resultsId}-${selectedItem.id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('commandCenter.placeholder')}
          data-testid="command-center-input"
          onChange={event => {
            setQuery(event.target.value)
            setActiveItemId(null)
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
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
              const currentQuery = normalizeQuery(event.currentTarget.value)
              // Use the input value even before React commits the final keystroke.
              const currentFlattenedItems = rankCommandSections(baseSections, currentQuery).flatMap(
                section => section.items,
              )
              const currentSelectedItem =
                currentFlattenedItems.length === 0
                  ? null
                  : activeItemId
                    ? (currentFlattenedItems.find(item => item.id === activeItemId) ??
                      currentFlattenedItems[0])
                    : currentFlattenedItems[0]

              if (!currentSelectedItem) {
                return
              }
              interactionModeRef.current = 'keyboard'
              event.preventDefault()
              activateItem(currentSelectedItem)
            }
          }}
        />

        <button
          ref={closeRef}
          type="button"
          className="command-center__close"
          aria-label={t('common.close')}
          title={t('common.close')}
          data-testid="command-center-close"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {activeWorkspace ? (
        <div className="command-center__context">
          <span>
            <ProjectIcon iconId={activeWorkspace.iconId} isExpanded />
            <span>{activeWorkspace.name}</span>
          </span>
          {activeSpace ? (
            <>
              <span className="command-center__context-divider" aria-hidden="true">
                /
              </span>
              <span data-cove-label-color={activeSpace.labelColor ?? undefined}>
                <Scan size={14} aria-hidden="true" />
                <span>{activeSpace.name}</span>
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <div
        className="command-center__results"
        ref={resultsRef}
        id={resultsId}
        aria-label={t('commandCenter.title')}
        role="listbox"
        onMouseMove={() => {
          interactionModeRef.current = 'pointer'
        }}
      >
        {sections.length === 0 ? (
          <div className="command-center__empty" role="status">
            {t('commandCenter.empty')}
          </div>
        ) : null}

        {sections.map(section => (
          <div
            key={section.id}
            className="command-center__section"
            role="group"
            aria-labelledby={`${resultsId}-section-${section.id}`}
          >
            <div
              id={`${resultsId}-section-${section.id}`}
              className="command-center__section-label"
            >
              {section.label}
            </div>
            <div className="command-center__section-items">
              {section.items.map(item => {
                const isSelected = selectedItem?.id === item.id
                return (
                  <button
                    key={item.id}
                    id={`${resultsId}-${item.id}`}
                    tabIndex={-1}
                    data-cove-label-color={item.labelColor ?? undefined}
                    aria-current={item.isCurrent ? 'location' : undefined}
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
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => activateItem(item)}
                  >
                    <span className="command-center__item-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="command-center__item-title">{item.title}</span>
                    {item.remoteLabel ? (
                      <span
                        className="command-center__remote"
                        aria-label={`${t('sidebar.remoteProject')}: ${item.remoteLabel}`}
                        title={item.remoteLabel}
                      >
                        <Server size={12} aria-hidden="true" />
                      </span>
                    ) : null}
                    {item.showCurrentMarker ? (
                      <Check className="command-center__current" size={13} aria-hidden="true" />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
