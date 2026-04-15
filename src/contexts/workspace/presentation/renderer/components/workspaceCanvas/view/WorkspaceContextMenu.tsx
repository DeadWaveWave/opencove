import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { WorkspaceContextArrangeBySubmenu } from './WorkspaceContextArrangeBySubmenu'
import {
  WorkspaceContextAgentProviderSubmenu,
  WorkspaceContextLabelColorSubmenu,
  WorkspaceContextPaneMenuContent,
  WorkspaceContextSelectionMenuContent,
} from './WorkspaceContextMenuParts'
import {
  WorkspaceContextQuickCommandsSubmenu,
  WorkspaceContextQuickPhrasesSubmenu,
} from './WorkspaceContextMenuQuickMenuParts'
import {
  MENU_WIDTH,
  SUBMENU_CLOSE_DELAY_MS,
  SUBMENU_GAP,
  SUBMENU_MAX_HEIGHT,
  SUBMENU_WIDTH,
  VIEWPORT_PADDING,
  placeContextMenuAtPoint,
  placeSubmenuAtItem,
} from './WorkspaceContextMenu.helpers'
import type { OpenSubmenu, WorkspaceContextMenuProps } from './WorkspaceContextMenu.types'
import { useWorkspaceContextArrangeMenuState } from './useWorkspaceContextArrangeMenuState'
import { useWorkspaceContextInstalledProviders } from './useWorkspaceContextInstalledProviders'

export function WorkspaceContextMenu({
  contextMenu,
  closeContextMenu,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  createWebsiteNodeFromContextMenu,
  websiteWindowsEnabled,
  openTaskCreator,
  openAgentLauncher,
  agentProviderOrder,
  openAgentLauncherForProvider,
  quickCommands,
  quickPhrases,
  runQuickCommand,
  insertQuickPhrase,
  openQuickMenuSettings,
  spaces,
  magneticSnappingEnabled,
  onToggleMagneticSnapping,
  canArrangeAll,
  canArrangeCanvas,
  arrangeAll,
  arrangeCanvas,
  arrangeInSpace,
  createSpaceFromSelectedNodes,
  createEmptySpaceAtPoint,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
  setSelectedNodeLabelColorOverride,
}: WorkspaceContextMenuProps): React.JSX.Element | null {
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenu>(null)
  const closeSubmenuTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const { sortedInstalledProviders, isLoadingInstalledProviders, ensureInstalledProvidersLoaded } =
    useWorkspaceContextInstalledProviders({ agentProviderOrder })

  const enabledQuickCommands = useMemo(
    () =>
      quickCommands.filter(
        command => command.enabled && (command.kind !== 'url' || websiteWindowsEnabled),
      ),
    [quickCommands, websiteWindowsEnabled],
  )

  const pinnedQuickCommands = useMemo(
    () => enabledQuickCommands.filter(command => command.pinned).slice(0, 4),
    [enabledQuickCommands],
  )

  const enabledQuickPhrases = quickPhrases.filter(phrase => phrase.enabled)

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
      setOpenSubmenu(previous => (previous === 'arrangeBy' ? previous : null))
    }, SUBMENU_CLOSE_DELAY_MS)
  }, [cancelScheduledSubmenuClose])

  const openAgentProviderSubmenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('agent-providers')

    ensureInstalledProvidersLoaded()
  }, [cancelScheduledSubmenuClose, ensureInstalledProvidersLoaded])

  const openArrangeSubmenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('arrangeBy')
  }, [cancelScheduledSubmenuClose])

  const openQuickCommandsSubmenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('quick-commands')
  }, [cancelScheduledSubmenuClose])

  const openQuickPhrasesSubmenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('quick-phrases')
  }, [cancelScheduledSubmenuClose])

  const openLabelColorSubmenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('label-color')
  }, [cancelScheduledSubmenuClose])

  useEffect(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu(null)
  }, [cancelScheduledSubmenuClose, contextMenu?.kind, contextMenu?.x, contextMenu?.y])

  useEffect(() => {
    return () => {
      cancelScheduledSubmenuClose()
    }
  }, [cancelScheduledSubmenuClose])

  const {
    contextHitSpace,
    arrangeScope,
    arrangeOrder,
    arrangeSpaceFit,
    applyArrange,
    handleArrangeScopeSelect,
    handleArrangeOrderSelect,
    handleArrangeSpaceFitSelect,
  } = useWorkspaceContextArrangeMenuState({
    contextMenu,
    spaces,
    arrangeAll,
    arrangeCanvas,
    arrangeInSpace,
  })
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const submenuRef = React.useRef<HTMLDivElement | null>(null)
  const agentProviderToggleRef = React.useRef<HTMLButtonElement | null>(null)
  const quickCommandsButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const quickPhrasesButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const arrangeByButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const labelColorButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const [measuredMenuSize, setMeasuredMenuSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [measuredSubmenuSize, setMeasuredSubmenuSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const commitArrangeAndClose = useCallback(() => {
    closeContextMenu()
    setOpenSubmenu(null)
    applyArrange()
  }, [applyArrange, closeContextMenu])

  const createEmptySpaceFromContextMenu = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    if (contextHitSpace) {
      return
    }

    closeContextMenu()
    setOpenSubmenu(null)
    createEmptySpaceAtPoint({ x: contextMenu.flowX, y: contextMenu.flowY })
  }, [closeContextMenu, contextHitSpace, contextMenu, createEmptySpaceAtPoint])

  const keepAgentProviderSubmenuOpen = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('agent-providers')
  }, [cancelScheduledSubmenuClose])

  const keepQuickCommandsSubmenuOpen = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('quick-commands')
  }, [cancelScheduledSubmenuClose])

  const keepQuickPhrasesSubmenuOpen = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('quick-phrases')
  }, [cancelScheduledSubmenuClose])

  const keepLabelColorSubmenuOpen = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('label-color')
  }, [cancelScheduledSubmenuClose])

  useLayoutEffect(() => {
    if (!contextMenu) {
      setMeasuredMenuSize(null)
      return
    }

    const menuElement = menuRef.current
    if (!menuElement) {
      setMeasuredMenuSize(null)
      return
    }

    const nextRect = menuElement.getBoundingClientRect()
    setMeasuredMenuSize(previous =>
      previous !== null &&
      Math.abs(previous.width - nextRect.width) < 0.5 &&
      Math.abs(previous.height - nextRect.height) < 0.5
        ? previous
        : { width: nextRect.width, height: nextRect.height },
    )
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!openSubmenu) {
      setMeasuredSubmenuSize(null)
      return
    }

    const submenuElement = submenuRef.current
    if (!submenuElement) {
      setMeasuredSubmenuSize(null)
      return
    }

    const nextRect = submenuElement.getBoundingClientRect()
    setMeasuredSubmenuSize(previous =>
      previous !== null &&
      Math.abs(previous.width - nextRect.width) < 0.5 &&
      Math.abs(previous.height - nextRect.height) < 0.5
        ? previous
        : { width: nextRect.width, height: nextRect.height },
    )
  }, [
    openSubmenu,
    contextMenu,
    enabledQuickCommands.length,
    enabledQuickPhrases.length,
    sortedInstalledProviders.length,
  ])

  if (!contextMenu) {
    return null
  }

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const menuSize = measuredMenuSize ?? {
    width: MENU_WIDTH,
    height: 0,
  }
  const rootMenuPlacement = placeContextMenuAtPoint({
    point: { x: contextMenu.x, y: contextMenu.y },
    menuSize,
    viewport: { width: viewportWidth, height: viewportHeight },
  })
  const rootMenuRect = {
    left: rootMenuPlacement.left,
    top: rootMenuPlacement.top,
    width: menuSize.width,
    height: menuSize.height,
  }
  const activeSubmenuAnchor =
    openSubmenu === 'arrangeBy'
      ? arrangeByButtonRef.current
      : openSubmenu === 'agent-providers'
        ? agentProviderToggleRef.current
        : openSubmenu === 'quick-commands'
          ? quickCommandsButtonRef.current
          : openSubmenu === 'quick-phrases'
            ? quickPhrasesButtonRef.current
            : openSubmenu === 'label-color'
              ? labelColorButtonRef.current
              : null
  const measuredSubmenuAnchorRect = activeSubmenuAnchor?.getBoundingClientRect() ?? null
  const submenuMaxHeight = Math.min(SUBMENU_MAX_HEIGHT, viewportHeight - VIEWPORT_PADDING * 2)
  const submenuVisibleHeight =
    measuredSubmenuSize !== null
      ? Math.min(submenuMaxHeight, measuredSubmenuSize.height)
      : submenuMaxHeight
  const submenuPlacement = placeSubmenuAtItem({
    parentMenuRect: rootMenuRect,
    itemRect: measuredSubmenuAnchorRect
      ? {
          left: measuredSubmenuAnchorRect.left,
          top: measuredSubmenuAnchorRect.top,
          width: measuredSubmenuAnchorRect.width,
          height: measuredSubmenuAnchorRect.height,
        }
      : {
          left: rootMenuRect.left,
          top: rootMenuRect.top,
          width: rootMenuRect.width,
          height: 0,
        },
    submenuSize: {
      width: measuredSubmenuSize?.width ?? SUBMENU_WIDTH,
      height: submenuVisibleHeight,
    },
    viewport: { width: viewportWidth, height: viewportHeight },
    gap: SUBMENU_GAP,
  })
  const canArrangeHitSpace = Boolean(contextHitSpace && contextHitSpace.nodeIds.length >= 2)
  const canArrangeCurrentScope =
    arrangeScope === 'all'
      ? canArrangeAll
      : arrangeScope === 'canvas'
        ? canArrangeCanvas
        : canArrangeHitSpace
  const shouldShowArrangeSubmenu = contextMenu.kind === 'pane' && openSubmenu === 'arrangeBy'
  const shouldShowAgentProviderSubmenu =
    contextMenu.kind === 'pane' &&
    openSubmenu === 'agent-providers' &&
    sortedInstalledProviders.length > 0
  const shouldShowQuickCommandsSubmenu =
    contextMenu.kind === 'pane' && openSubmenu === 'quick-commands'
  const shouldShowQuickPhrasesSubmenu =
    contextMenu.kind === 'pane' && openSubmenu === 'quick-phrases'
  const shouldShowLabelColorSubmenu =
    contextMenu.kind === 'selection' && openSubmenu === 'label-color'
  const sharedSubmenuStyle = {
    top: submenuPlacement.top,
    left: submenuPlacement.left,
    maxHeight: submenuMaxHeight,
  }

  return (
    <>
      <div
        ref={menuRef}
        className="workspace-context-menu workspace-canvas-context-menu"
        style={{ top: rootMenuPlacement.top, left: rootMenuPlacement.left }}
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
          <WorkspaceContextPaneMenuContent
            createTerminalNode={createTerminalNode}
            createNoteNodeFromContextMenu={createNoteNodeFromContextMenu}
            createWebsiteNodeFromContextMenu={createWebsiteNodeFromContextMenu}
            websiteWindowsEnabled={websiteWindowsEnabled}
            openTaskCreator={openTaskCreator}
            openAgentLauncher={openAgentLauncher}
            createEmptySpaceFromContextMenu={createEmptySpaceFromContextMenu}
            canCreateEmptySpace={contextHitSpace === null}
            openAgentProviderSubmenu={openAgentProviderSubmenu}
            agentProviderToggleRef={agentProviderToggleRef}
            isLoadingInstalledProviders={isLoadingInstalledProviders}
            isAgentProviderSubmenuOpen={openSubmenu === 'agent-providers'}
            pinnedQuickCommands={pinnedQuickCommands}
            runQuickCommand={runQuickCommand}
            quickCommandsButtonRef={quickCommandsButtonRef}
            openQuickCommandsSubmenu={openQuickCommandsSubmenu}
            isQuickCommandsSubmenuOpen={openSubmenu === 'quick-commands'}
            quickPhrasesButtonRef={quickPhrasesButtonRef}
            openQuickPhrasesSubmenu={openQuickPhrasesSubmenu}
            isQuickPhrasesSubmenuOpen={openSubmenu === 'quick-phrases'}
            openQuickMenuSettings={() => {
              closeContextMenu()
              setOpenSubmenu(null)
              openQuickMenuSettings()
            }}
            canArrangeCurrentScope={canArrangeCurrentScope}
            commitArrangeAndClose={() => {
              commitArrangeAndClose()
            }}
            arrangeByButtonRef={arrangeByButtonRef}
            openArrangeSubmenu={openArrangeSubmenu}
            isArrangeSubmenuOpen={openSubmenu === 'arrangeBy'}
            magneticSnappingEnabled={magneticSnappingEnabled}
            onToggleMagneticSnapping={onToggleMagneticSnapping}
          />
        ) : (
          <WorkspaceContextSelectionMenuContent
            createSpaceFromSelectedNodes={createSpaceFromSelectedNodes}
            openLabelColorSubmenu={openLabelColorSubmenu}
            labelColorButtonRef={labelColorButtonRef}
            canConvertSelectedNoteToTask={canConvertSelectedNoteToTask}
            isConvertSelectedNoteToTaskDisabled={isConvertSelectedNoteToTaskDisabled}
            convertSelectedNoteToTask={convertSelectedNoteToTask}
            clearNodeSelection={clearNodeSelection}
            closeContextMenu={closeContextMenu}
          />
        )}
      </div>

      {shouldShowArrangeSubmenu ? (
        <WorkspaceContextArrangeBySubmenu
          submenuRef={submenuRef}
          style={{
            top: submenuPlacement.top,
            left: submenuPlacement.left,
            maxHeight: submenuMaxHeight,
          }}
          hitSpace={contextHitSpace}
          canArrangeAll={canArrangeAll}
          canArrangeCanvas={canArrangeCanvas}
          canArrangeHitSpace={canArrangeHitSpace}
          arrangeScope={arrangeScope}
          arrangeOrder={arrangeOrder}
          arrangeSpaceFit={arrangeSpaceFit}
          onSelectScope={handleArrangeScopeSelect}
          onSelectOrder={handleArrangeOrderSelect}
          onSelectSpaceFit={handleArrangeSpaceFitSelect}
        />
      ) : null}

      {shouldShowAgentProviderSubmenu ? (
        <WorkspaceContextAgentProviderSubmenu
          sortedInstalledProviders={sortedInstalledProviders}
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepAgentProviderSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          openAgentLauncherForProvider={openAgentLauncherForProvider}
        />
      ) : null}

      {shouldShowQuickCommandsSubmenu ? (
        <WorkspaceContextQuickCommandsSubmenu
          commands={enabledQuickCommands}
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepQuickCommandsSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          runQuickCommand={runQuickCommand}
          openQuickMenuSettings={() => {
            closeContextMenu()
            setOpenSubmenu(null)
            openQuickMenuSettings()
          }}
        />
      ) : null}

      {shouldShowQuickPhrasesSubmenu ? (
        <WorkspaceContextQuickPhrasesSubmenu
          phrases={enabledQuickPhrases}
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepQuickPhrasesSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          insertQuickPhrase={insertQuickPhrase}
          openQuickMenuSettings={() => {
            closeContextMenu()
            setOpenSubmenu(null)
            openQuickMenuSettings()
          }}
        />
      ) : null}

      {shouldShowLabelColorSubmenu ? (
        <WorkspaceContextLabelColorSubmenu
          submenuRef={submenuRef}
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepLabelColorSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          setSelectedNodeLabelColorOverride={setSelectedNodeLabelColorOverride}
          closeContextMenu={closeContextMenu}
        />
      ) : null}
    </>
  )
}
