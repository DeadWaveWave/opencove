import type React from 'react'
import { X } from 'lucide-react'
import { IconButton } from '@app/renderer/components/ui/IconButton'

/**
 * The close control every window header ends with. Callers name it for what it does
 * (close, delete) and keep their own close guard in onClose.
 */
export function WindowCloseButton({
  label,
  onClose,
  className,
  onPointerDown,
  'data-testid': testId,
}: {
  label: string
  onClose: () => void
  className?: string
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void
  'data-testid'?: string
}): React.JSX.Element {
  return (
    <IconButton
      label={label}
      size="xs"
      className={['cove-window-control nodrag', className].filter(Boolean).join(' ')}
      data-testid={testId}
      onPointerDown={event => {
        event.stopPropagation()
        onPointerDown?.(event)
      }}
      onClick={event => {
        event.stopPropagation()
        onClose()
      }}
    >
      <X aria-hidden="true" />
    </IconButton>
  )
}
