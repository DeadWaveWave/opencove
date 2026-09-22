import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TerminalNodeData } from '../../../types'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'
import { getCollapsedNodeSize } from '../../../utils/canvasCollapse'
import { WindowCollapseContext } from '../../shared/WindowCollapseButton'
import { useWorkspaceCollapse } from './WorkspaceCollapseContext'
import { useCollapsedAgentMessage } from './useCollapsedAgentMessage'
import { CollapsedWindow } from './CollapsedWindow'
import { useWindowCollapseMotion } from './useWindowCollapseMotion'
import { WindowNodeContextMenuContext } from '../view/WindowNodeContextMenuContext'

/** Presentation geometry is independent of the mounted editor/PTY/browser frame. */
export function WindowCollapsePresentation({
  id,
  data,
  children,
  onToggleSelection,
  onSelect,
}: {
  id: string
  data: TerminalNodeData
  children: ReactNode
  onToggleSelection?: () => void
  onSelect?: () => void
}) {
  const collapse = useWorkspaceCollapse()
  const openContextMenu = useContext(WindowNodeContextMenuContext)
  const collapsed = data.collapsePresentation?.collapsed === true
  const spaceHidden = data.collapsePresentation?.spaceHidden === true
  const hidden = collapsed || spaceHidden
  const closeHandler = useRef<(() => void) | null>(null)
  const element = useRef<HTMLDivElement>(null)
  useWindowCollapseMotion(
    element,
    collapsed,
    spaceHidden,
    data,
    getCollapsedNodeSize(data),
    collapse.getMotionDelay?.(id) ?? 0,
  )
  const [inView, setInView] = useState(true)
  const isAgent = resolveAgentPresentation(data).isAgent
  useEffect(() => {
    if (
      !collapsed ||
      spaceHidden ||
      !isAgent ||
      !element.current ||
      typeof IntersectionObserver !== 'function'
    ) {
      return
    }
    const observer = new IntersectionObserver(entries => {
      setInView(entries.some(entry => entry.isIntersecting))
    })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [collapsed, isAgent, spaceHidden])
  const message = useCollapsedAgentMessage(data, collapsed && !spaceHidden && isAgent && inView)
  const controls = useMemo(
    () => ({
      nodeId: id,
      collapsed,
      hidden,
      registerCloseHandler: (handler: () => void) => {
        closeHandler.current = handler
        return () => {
          if (closeHandler.current === handler) {
            closeHandler.current = null
          }
        }
      },
      toggle: () => collapse?.toggleNode(id),
    }),
    [collapse, collapsed, hidden, id],
  )

  return (
    <WindowCollapseContext.Provider value={collapse ? controls : null}>
      <div
        ref={element}
        className="cove-node-presentation"
        data-cove-collapsed={collapsed || undefined}
        data-cove-space-hidden={spaceHidden || undefined}
      >
        <div className="cove-node-presentation__surface" aria-hidden="true" />
        <div
          id={`cove-node-runtime-${id}`}
          className="cove-node-presentation__runtime"
          style={{ width: data.width, height: data.height }}
          inert={hidden}
          aria-hidden={hidden || undefined}
        >
          {children}
        </div>
        {!spaceHidden ? (
          <div
            className="cove-node-presentation__compact"
            inert={!collapsed}
            aria-hidden={!collapsed || undefined}
          >
            <CollapsedWindow
              id={id}
              data={data}
              active={collapsed}
              message={message}
              onExpand={controls.toggle}
              onToggleSelection={onToggleSelection}
              onContextMenu={
                openContextMenu
                  ? point => {
                      onSelect?.()
                      openContextMenu({ ...point, closeWindow: () => closeHandler.current?.() })
                    }
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>
    </WindowCollapseContext.Provider>
  )
}
