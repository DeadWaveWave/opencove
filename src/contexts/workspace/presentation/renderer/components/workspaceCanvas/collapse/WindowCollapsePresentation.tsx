import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TerminalNodeData } from '../../../types'
import { resolveAgentPresentation } from '../../../utils/agentPresentation'
import { WindowCollapseContext } from '../../shared/WindowCollapseButton'
import { useWorkspaceCollapse } from './WorkspaceCollapseContext'
import { useCollapsedAgentMessage } from './useCollapsedAgentMessage'
import { CollapsedWindow } from './CollapsedWindow'

/** Presentation geometry is independent of the mounted editor/PTY/browser frame. */
export function WindowCollapsePresentation({
  id,
  data,
  children,
  onToggleSelection,
}: {
  id: string
  data: TerminalNodeData
  children: ReactNode
  onToggleSelection?: () => void
}) {
  const collapse = useWorkspaceCollapse()
  const collapsed = data.collapsePresentation?.collapsed === true
  const spaceHidden = data.collapsePresentation?.spaceHidden === true
  const hidden = collapsed || spaceHidden
  const closeHandler = useRef<(() => void) | null>(null)
  const element = useRef<HTMLDivElement>(null)
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
        <div
          id={`cove-node-runtime-${id}`}
          className="cove-node-presentation__runtime"
          style={{ width: data.width, height: data.height }}
          inert={hidden}
          aria-hidden={hidden || undefined}
        >
          {children}
        </div>
        {collapsed && !spaceHidden ? (
          <CollapsedWindow
            id={id}
            data={data}
            message={message}
            onExpand={controls.toggle}
            onToggleSelection={onToggleSelection}
            onClose={() => closeHandler.current?.()}
          />
        ) : null}
      </div>
    </WindowCollapseContext.Provider>
  )
}
