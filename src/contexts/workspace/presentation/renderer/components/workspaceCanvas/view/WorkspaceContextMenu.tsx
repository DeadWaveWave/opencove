import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { AGENT_PROVIDERS, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import type {
  WorkspaceArrangeOrder,
  WorkspaceArrangeSpaceFit,
  WorkspaceArrangeStyle,
} from '../../../utils/workspaceArrange'
import {
  WorkspaceContextArrangeBySubmenu,
  type ArrangeScope,
} from './WorkspaceContextArrangeBySubmenu'
import {
  WorkspaceContextAgentProviderSubmenu,
  WorkspaceContextLabelColorSubmenu,
  WorkspaceContextPaneMenuContent,
  WorkspaceContextSelectionMenuContent,
} from './WorkspaceContextMenuParts'
import {
  MENU_WIDTH,
  SUBMENU_CLOSE_DELAY_MS,
  SUBMENU_GAP,
  SUBMENU_MAX_HEIGHT,
  SUBMENU_WIDTH,
  VIEWPORT_PADDING,
  isPointWithinRect,
  placeContextMenuAtPoint,
  placeSubmenuAtItem,
} from './WorkspaceContextMenu.helpers'
import type { OpenSubmenu, WorkspaceContextMenuProps } from './WorkspaceContextMenu.types'

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
  spaces,
  magneticSnappingEnabled,
  onToggleMagneticSnapping,
  canArrangeAll,
  canArrangeCanvas,
  arrangeAll,
  arrangeCanvas,
  arrangeInSpace,
  createSpaceFromSelectedNodes,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
  setSelectedNodeLabelColorOverride,
}: WorkspaceContextMenuProps): React.JSX.Element | null {
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenu>(null)
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
      setOpenSubmenu(previous => (previous === 'arrangeBy' ? previous : null))
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

  const openArrangeSubmenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('arrangeBy')
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

  const [contextHitSpaceId, setContextHitSpaceId] = useState<string | null>(null)
  const contextHitSpaceIdRef = React.useRef<string | null>(null)
  const contextMenuSignatureRef = React.useRef<string | null>(null)
  const [arrangeScope, setArrangeScope] = useState<ArrangeScope>('canvas')
  const arrangeScopeRef = React.useRef<ArrangeScope>('canvas')
  const [arrangeOrder, setArrangeOrder] = useState<WorkspaceArrangeOrder>('position')
  const arrangeOrderRef = React.useRef<WorkspaceArrangeOrder>('position')
  const [arrangeSpaceFit, setArrangeSpaceFit] = useState<WorkspaceArrangeSpaceFit>('tight')
  const arrangeSpaceFitRef = React.useRef<WorkspaceArrangeSpaceFit>('tight')
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const submenuRef = React.useRef<HTMLDivElement | null>(null)
  const agentProviderToggleRef = React.useRef<HTMLButtonElement | null>(null)
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

  useEffect(() => {
    const signature = contextMenu
      ? `${contextMenu.kind}:${contextMenu.x}:${contextMenu.y}:${'flowX' in contextMenu ? contextMenu.flowX : 0}:${
          'flowY' in contextMenu ? contextMenu.flowY : 0
        }`
      : 'null'

    if (signature === contextMenuSignatureRef.current) {
      return
    }

    contextMenuSignatureRef.current = signature
    setOpenSubmenu(null)

    if (!contextMenu || contextMenu.kind !== 'pane') {
      contextHitSpaceIdRef.current = null
      setContextHitSpaceId(null)
      arrangeScopeRef.current = 'canvas'
      setArrangeScope('canvas')
      return
    }

    const anchor = { x: contextMenu.flowX, y: contextMenu.flowY }
    const hitSpace =
      spaces.find(space => space.rect && isPointWithinRect(anchor, space.rect)) ?? null
    const nextHitSpaceId = hitSpace?.id ?? null

    contextHitSpaceIdRef.current = nextHitSpaceId
    setContextHitSpaceId(nextHitSpaceId)

    const nextScope: ArrangeScope = nextHitSpaceId ? 'space' : 'canvas'
    arrangeScopeRef.current = nextScope
    setArrangeScope(nextScope)
  }, [contextMenu, spaces])

  const contextHitSpace = useMemo(() => {
    if (!contextHitSpaceId) {
      return null
    }

    return spaces.find(space => space.id === contextHitSpaceId) ?? null
  }, [contextHitSpaceId, spaces])

  const resolveCurrentArrangeStyle = useCallback((): WorkspaceArrangeStyle => {
    return {
      order: arrangeOrderRef.current,
      spaceFit: arrangeSpaceFitRef.current,
    }
  }, [])

  const applyArrange = useCallback(
    (options?: { scope?: ArrangeScope; style?: WorkspaceArrangeStyle }) => {
      const scope = options?.scope ?? arrangeScopeRef.current
      const style = options?.style ?? resolveCurrentArrangeStyle()

      if (scope === 'all') {
        arrangeAll(style)
        return
      }

      if (scope === 'canvas') {
        arrangeCanvas(style)
        return
      }

      const spaceId = contextHitSpaceIdRef.current
      if (spaceId) {
        arrangeInSpace(spaceId, style)
      }
    },
    [arrangeAll, arrangeCanvas, arrangeInSpace, resolveCurrentArrangeStyle],
  )

  const commitArrangeAndClose = useCallback(
    (options?: { scope?: ArrangeScope; style?: WorkspaceArrangeStyle }) => {
      closeContextMenu()
      setOpenSubmenu(null)
      applyArrange(options)
    },
    [applyArrange, closeContextMenu],
  )

  const keepAgentProviderSubmenuOpen = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('agent-providers')
  }, [cancelScheduledSubmenuClose])

  const keepLabelColorSubmenuOpen = useCallback(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu('label-color')
  }, [cancelScheduledSubmenuClose])

  const handleArrangeScopeSelect = useCallback(
    (scope: ArrangeScope) => {
      arrangeScopeRef.current = scope
      setArrangeScope(scope)
      applyArrange({ scope })
    },
    [applyArrange],
  )

  const handleArrangeOrderSelect = useCallback(
    (order: WorkspaceArrangeOrder) => {
      arrangeOrderRef.current = order
      setArrangeOrder(order)
      applyArrange()
    },
    [applyArrange],
  )

  const handleArrangeSpaceFitSelect = useCallback(
    (spaceFit: WorkspaceArrangeSpaceFit) => {
      arrangeSpaceFitRef.current = spaceFit
      setArrangeSpaceFit(spaceFit)
      applyArrange()
    },
    [applyArrange],
  )

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
  }, [openSubmenu, contextMenu, sortedInstalledProviders.length])

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
            openAgentProviderSubmenu={openAgentProviderSubmenu}
            agentProviderToggleRef={agentProviderToggleRef}
            isLoadingInstalledProviders={isLoadingInstalledProviders}
            isAgentProviderSubmenuOpen={openSubmenu === 'agent-providers'}
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
