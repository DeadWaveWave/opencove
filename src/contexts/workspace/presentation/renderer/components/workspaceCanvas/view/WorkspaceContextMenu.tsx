import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { AGENT_PROVIDERS, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState } from '../types'
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
} from './WorkspaceContextMenu.helpers'

type OpenSubmenu = 'arrangeBy' | 'agent-providers' | 'label-color' | null

interface WorkspaceContextMenuProps {
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  openTaskCreator: () => void
  openAgentLauncher: () => void
  agentProviderOrder: AgentProvider[]
  openAgentLauncherForProvider: (provider: AgentProvider) => void
  spaces: WorkspaceSpaceState[]
  magneticSnappingEnabled: boolean
  onToggleMagneticSnapping: () => void
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
  createSpaceFromSelectedNodes: () => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
  setSelectedNodeLabelColorOverride: (labelColorOverride: NodeLabelColorOverride) => void
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
  const arrangeByButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const [arrangeSubmenuLayout, setArrangeSubmenuLayout] = React.useState<{
    left: number
    top: number
    maxHeight: number
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
    if (!contextMenu || contextMenu.kind !== 'pane' || openSubmenu !== 'arrangeBy') {
      setArrangeSubmenuLayout(null)
      return
    }

    const menuElement = menuRef.current
    const anchorButton = arrangeByButtonRef.current
    if (!menuElement || !anchorButton) {
      setArrangeSubmenuLayout(null)
      return
    }

    const menuRect = menuElement.getBoundingClientRect()
    const anchorRect = anchorButton.getBoundingClientRect()
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
    const maxHeight = Math.min(SUBMENU_MAX_HEIGHT, viewportHeight - VIEWPORT_PADDING * 2)
    const wouldOverflowRight =
      menuRect.right + SUBMENU_GAP + SUBMENU_WIDTH > viewportWidth - VIEWPORT_PADDING
    const left = wouldOverflowRight
      ? Math.max(VIEWPORT_PADDING, menuRect.left - SUBMENU_GAP - SUBMENU_WIDTH)
      : Math.min(viewportWidth - VIEWPORT_PADDING - SUBMENU_WIDTH, menuRect.right + SUBMENU_GAP)
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(anchorRect.top, viewportHeight - VIEWPORT_PADDING - maxHeight),
    )

    setArrangeSubmenuLayout({ left, top, maxHeight })
  }, [contextMenu, openSubmenu])

  if (!contextMenu) {
    return null
  }

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const anchorX = Math.min(
    Math.max(contextMenu.x, VIEWPORT_PADDING),
    Math.max(VIEWPORT_PADDING, viewportWidth - VIEWPORT_PADDING),
  )
  const anchorY = Math.min(
    Math.max(contextMenu.y, VIEWPORT_PADDING),
    Math.max(VIEWPORT_PADDING, viewportHeight - VIEWPORT_PADDING),
  )
  const flipX = contextMenu.x > viewportWidth / 2
  const flipY = contextMenu.y > viewportHeight / 2
  const menuTransform =
    flipX || flipY ? `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})` : undefined
  const measuredMenuRect = menuRef.current?.getBoundingClientRect() ?? null
  const submenuMaxHeight = Math.min(SUBMENU_MAX_HEIGHT, viewportHeight - VIEWPORT_PADDING * 2)
  const fallbackSubmenuLeft = flipX
    ? Math.max(VIEWPORT_PADDING, anchorX - MENU_WIDTH - SUBMENU_GAP - SUBMENU_WIDTH)
    : Math.min(viewportWidth - VIEWPORT_PADDING - SUBMENU_WIDTH, anchorX + MENU_WIDTH + SUBMENU_GAP)
  const fallbackSubmenuTop = Math.max(
    VIEWPORT_PADDING,
    Math.min(anchorY, viewportHeight - VIEWPORT_PADDING - submenuMaxHeight),
  )
  const submenuLeft = measuredMenuRect
    ? measuredMenuRect.right + SUBMENU_GAP + SUBMENU_WIDTH > viewportWidth - VIEWPORT_PADDING
      ? Math.max(VIEWPORT_PADDING, measuredMenuRect.left - SUBMENU_GAP - SUBMENU_WIDTH)
      : Math.min(
          viewportWidth - VIEWPORT_PADDING - SUBMENU_WIDTH,
          measuredMenuRect.right + SUBMENU_GAP,
        )
    : fallbackSubmenuLeft
  const submenuTop = measuredMenuRect
    ? Math.max(
        VIEWPORT_PADDING,
        Math.min(measuredMenuRect.top, viewportHeight - VIEWPORT_PADDING - submenuMaxHeight),
      )
    : fallbackSubmenuTop
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
    top: submenuTop,
    left: submenuLeft,
    maxHeight: submenuMaxHeight,
  }

  return (
    <>
      <div
        ref={menuRef}
        className="workspace-context-menu workspace-canvas-context-menu"
        style={{ top: anchorY, left: anchorX, transform: menuTransform }}
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
            openTaskCreator={openTaskCreator}
            openAgentLauncher={openAgentLauncher}
            openAgentProviderSubmenu={openAgentProviderSubmenu}
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
          style={{
            top: arrangeSubmenuLayout?.top ?? submenuTop,
            left: arrangeSubmenuLayout?.left ?? submenuLeft,
            maxHeight: arrangeSubmenuLayout?.maxHeight ?? submenuMaxHeight,
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
          style={sharedSubmenuStyle}
          keepSubmenuOpen={keepAgentProviderSubmenuOpen}
          scheduleSubmenuClose={scheduleSubmenuClose}
          openAgentLauncherForProvider={openAgentLauncherForProvider}
        />
      ) : null}

      {shouldShowLabelColorSubmenu ? (
        <WorkspaceContextLabelColorSubmenu
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
