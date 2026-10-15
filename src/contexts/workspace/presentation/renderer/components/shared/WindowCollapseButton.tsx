import { createContext, useContext, useLayoutEffect } from 'react'
import { Minus } from 'lucide-react'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { useTranslation } from '@app/renderer/i18n'

export interface WindowCollapseControls {
  nodeId: string
  collapsed: boolean
  hidden: boolean
  toggle: () => void
  registerCloseHandler: (handler: () => void) => () => void
}

export const WindowCollapseContext = createContext<WindowCollapseControls | null>(null)

export function useWindowPresentationHidden(): boolean {
  return useContext(WindowCollapseContext)?.hidden ?? false
}

/** Each runtime owner supplies its own close guard; compact chrome never bypasses it. */
export function WindowCollapseButton({
  onClose,
  revealBeforeClose = false,
  className = '',
}: {
  onClose: () => void
  revealBeforeClose?: boolean
  className?: string
}) {
  const controls = useContext(WindowCollapseContext)
  const { t } = useTranslation()
  useLayoutEffect(() => {
    if (!controls) {
      return
    }
    const close = () => {
      if (revealBeforeClose && controls.collapsed) {
        controls.toggle()
      }
      onClose()
    }
    return controls.registerCloseHandler(close)
  }, [controls, onClose, revealBeforeClose])

  if (!controls) {
    return null
  }
  return (
    <IconButton
      label={t('canvasCollapse.collapseWindow')}
      size="xs"
      className={`cove-window-control cove-node-collapse-button nodrag ${className}`.trim()}
      data-testid="node-collapse"
      aria-expanded={!controls.collapsed}
      aria-controls={`cove-node-runtime-${controls.nodeId}`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation()
        controls.toggle()
      }}
    >
      <Minus aria-hidden="true" />
    </IconButton>
  )
}
