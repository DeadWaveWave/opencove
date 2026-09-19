import { createContext, useContext, useLayoutEffect } from 'react'
import { Minus } from 'lucide-react'
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
    <button
      type="button"
      className={`cove-node-collapse-button nodrag ${className}`.trim()}
      data-testid="node-collapse"
      aria-label={t('canvasCollapse.collapseWindow')}
      title={t('canvasCollapse.collapseWindow')}
      aria-expanded={!controls.collapsed}
      aria-controls={`cove-node-runtime-${controls.nodeId}`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation()
        controls.toggle()
      }}
    >
      <Minus size={15} strokeWidth={1.7} aria-hidden="true" />
    </button>
  )
}
