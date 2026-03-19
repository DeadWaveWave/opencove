import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Group,
  ListTodo,
  LoaderCircle,
  Play,
  Terminal,
  X,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDERS,
  AGENT_PROVIDER_LABEL,
  type AgentProvider,
} from '@contexts/settings/domain/agentSettings'
import type { ContextMenuState } from '../types'

const MENU_WIDTH = 188
const SUBMENU_WIDTH = 188
const VIEWPORT_PADDING = 12
const SUBMENU_CLOSE_DELAY_MS = 120

interface WorkspaceContextMenuProps {
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  openTaskCreator: () => void
  openAgentLauncher: () => void
  agentProviderOrder: AgentProvider[]
  openAgentLauncherForProvider: (provider: AgentProvider) => void
  createSpaceFromSelectedNodes: () => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
}

export function WorkspaceContextMenu({
  contextMenu,
  closeContextMenu,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  openTaskCreator,
  openAgentLauncher,
  agentProviderOrder,
  openAgentLauncherForProvider,
  createSpaceFromSelectedNodes,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
}: WorkspaceContextMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [openSubmenu, setOpenSubmenu] = useState<'agent-providers' | null>(null)
  const closeSubmenuTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const [installedProviders, setInstalledProviders] = useState<AgentProvider[] | null>(null)
  const [isLoadingInstalledProviders, setIsLoadingInstalledProviders] = useState(false)

  const sortedInstalledProviders = useMemo(() => {
    if (!installedProviders) {
      return []
    }

    const effectiveOrder = agentProviderOrder.length > 0 ? agentProviderOrder : AGENT_PROVIDERS
    return effectiveOrder.filter(provider => installedProviders.includes(provider))
  }, [agentProviderOrder, installedProviders])

  const cancelScheduledSubmenuClose = useCallback(() => {
    if (closeSubmenuTimeoutRef.current === null) {
      return
    }

    clearTimeout(closeSubmenuTimeoutRef.current)
    closeSubmenuTimeoutRef.current = null
  }, [])

  const scheduleSubmenuClose = useCallback(() => {
    cancelScheduledSubmenuClose()
    closeSubmenuTimeoutRef.current = setTimeout(() => {
      closeSubmenuTimeoutRef.current = null
      setOpenSubmenu(null)
    }, SUBMENU_CLOSE_DELAY_MS)
  }, [cancelScheduledSubmenuClose])

  const loadInstalledProviders = useCallback(async () => {
    if (installedProviders !== null || isLoadingInstalledProviders) {
      return
    }

    setIsLoadingInstalledProviders(true)

    try {
      const result = await window.opencoveApi.agent.listInstalledProviders()
      setInstalledProviders(result.providers)
    } catch {
      setInstalledProviders([])
    } finally {
      setIsLoadingInstalledProviders(false)
    }
  }, [installedProviders, isLoadingInstalledProviders])

  const openAgentProviderSubmenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('agent-providers')

    if (installedProviders === null && !isLoadingInstalledProviders) {
      void loadInstalledProviders()
    }
  }, [
    cancelScheduledSubmenuClose,
    installedProviders,
    isLoadingInstalledProviders,
    loadInstalledProviders,
  ])

  const toggleAgentProviderSubmenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu(previous => {
      const next = previous === 'agent-providers' ? null : 'agent-providers'
      if (next && installedProviders === null && !isLoadingInstalledProviders) {
        void loadInstalledProviders()
      }
      return next
    })
  }, [
    cancelScheduledSubmenuClose,
    installedProviders,
    isLoadingInstalledProviders,
    loadInstalledProviders,
  ])

  useEffect(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu(null)
  }, [cancelScheduledSubmenuClose, contextMenu?.kind, contextMenu?.x, contextMenu?.y])

  useEffect(() => {
    return () => {
      cancelScheduledSubmenuClose()
    }
  }, [cancelScheduledSubmenuClose])

  if (!contextMenu) {
    return null
  }

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const menuLeft = Math.min(contextMenu.x, viewportWidth - MENU_WIDTH - VIEWPORT_PADDING)
  const menuTop = Math.min(contextMenu.y, viewportHeight - 120)

  const shouldShowAgentProviderSubmenu =
    contextMenu.kind === 'pane' &&
    openSubmenu === 'agent-providers' &&
    sortedInstalledProviders.length > 0
  const submenuWouldOverflow =
    menuLeft + MENU_WIDTH + SUBMENU_WIDTH > viewportWidth - VIEWPORT_PADDING
  const submenuLeft = submenuWouldOverflow ? menuLeft - SUBMENU_WIDTH : menuLeft + MENU_WIDTH
  const submenuTop = menuTop

  return (
    <>
      <div
        className="workspace-context-menu workspace-canvas-context-menu"
        style={{ top: menuTop, left: menuLeft }}
        onMouseDown={event => {
          event.stopPropagation()
        }}
        onClick={event => {
          event.stopPropagation()
        }}
        onMouseEnter={cancelScheduledSubmenuClose}
        onMouseLeave={scheduleSubmenuClose}
      >
        {contextMenu.kind === 'pane' ? (
          <>
            <button
              type="button"
              data-testid="workspace-context-new-terminal"
              onClick={() => {
                void createTerminalNode()
              }}
            >
              <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.newTerminal')}
              </span>
            </button>
            <button
              type="button"
              data-testid="workspace-context-new-note"
              onClick={() => {
                createNoteNodeFromContextMenu()
              }}
            >
              <FileText className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.newNote')}
              </span>
            </button>
            <button
              type="button"
              data-testid="workspace-context-new-task"
              onClick={() => {
                openTaskCreator()
              }}
            >
              <ListTodo className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.newTask')}
              </span>
            </button>
            <div className="workspace-context-menu__split">
              <button
                type="button"
                data-testid="workspace-context-run-default-agent"
                className="workspace-context-menu__split-main"
                onClick={openAgentLauncher}
              >
                <Play className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.runAgent')}
                </span>
              </button>
              <button
                type="button"
                data-testid="workspace-context-run-agent-provider-toggle"
                className="workspace-context-menu__split-toggle"
                aria-label={t('workspaceContextMenu.runAgent')}
                onMouseEnter={openAgentProviderSubmenu}
                onFocus={openAgentProviderSubmenu}
                onClick={toggleAgentProviderSubmenu}
              >
                {isLoadingInstalledProviders ? (
                  <LoaderCircle
                    className="workspace-context-menu__icon workspace-context-menu__spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className={`workspace-context-menu__icon workspace-context-menu__chevron ${
                      openSubmenu === 'agent-providers'
                        ? 'workspace-context-menu__chevron--open'
                        : ''
                    }`}
                    aria-hidden="true"
                  />
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              data-testid="workspace-selection-create-space"
              onClick={() => {
                createSpaceFromSelectedNodes()
              }}
            >
              <Group className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.createSpaceWithSelected')}
              </span>
            </button>
            {canConvertSelectedNoteToTask ? (
              <button
                type="button"
                data-testid="workspace-selection-convert-note-to-task"
                disabled={isConvertSelectedNoteToTaskDisabled}
                onClick={() => {
                  convertSelectedNoteToTask()
                }}
              >
                <ArrowRight className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.convertToTask')}
                </span>
              </button>
            ) : null}
            <button
              type="button"
              data-testid="workspace-selection-clear"
              onClick={() => {
                clearNodeSelection()
                closeContextMenu()
              }}
            >
              <X className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.clearSelection')}
              </span>
            </button>
          </>
        )}
      </div>

      {shouldShowAgentProviderSubmenu ? (
        <div
          className="workspace-context-menu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
          data-testid="workspace-context-run-agent-provider-menu"
          style={{ top: submenuTop, left: submenuLeft }}
          onMouseDown={event => {
            event.stopPropagation()
          }}
          onClick={event => {
            event.stopPropagation()
          }}
          onMouseEnter={() => {
            cancelScheduledSubmenuClose()
            setOpenSubmenu('agent-providers')
          }}
          onMouseLeave={scheduleSubmenuClose}
        >
          {sortedInstalledProviders.map(provider => (
            <button
              key={provider}
              type="button"
              data-testid={`workspace-context-run-agent-${provider}`}
              onClick={() => {
                openAgentLauncherForProvider(provider)
              }}
            >
              <Play className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {AGENT_PROVIDER_LABEL[provider]}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
