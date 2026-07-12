import React from 'react'
import { ViewportMenuSurface } from './ViewportMenuSurface'
import {
  targetBelongsToTransientLayer,
  TransientLayerOwnerProvider,
} from './TransientLayerOwnerContext'

export interface AnchoredOperationPopoverAnchor {
  x: number
  y: number
}

export function AnchoredOperationPopover({
  anchor,
  ariaLabel,
  children,
  className,
  dismissDisabled = false,
  estimatedHeight = 360,
  estimatedWidth = 360,
  onDismiss,
  testId,
}: {
  anchor: AnchoredOperationPopoverAnchor
  ariaLabel: string
  children: React.ReactNode
  className?: string
  dismissDisabled?: boolean
  estimatedHeight?: number
  estimatedWidth?: number
  onDismiss: () => void
  testId: string
}): React.JSX.Element {
  const ownerId = React.useId()

  return (
    <TransientLayerOwnerProvider value={ownerId}>
      <ViewportMenuSurface
        open
        aria-label={ariaLabel}
        aria-modal="false"
        className={
          className ? `anchored-operation-popover ${className}` : 'anchored-operation-popover'
        }
        data-testid={testId}
        dismissOnEscape={!dismissDisabled}
        dismissOnPointerDownOutside={!dismissDisabled}
        dismissIgnoreTarget={target => targetBelongsToTransientLayer(target, ownerId)}
        onDismiss={onDismiss}
        placement={{
          type: 'point',
          point: anchor,
          alignX: 'start',
          alignY: 'start',
          padding: 10,
          estimatedSize: { width: estimatedWidth, height: estimatedHeight },
        }}
        role="dialog"
        waitForMeasurement
        onContextMenu={event => {
          event.stopPropagation()
        }}
        onPointerDown={event => {
          event.stopPropagation()
        }}
        onWheel={event => {
          event.stopPropagation()
        }}
      >
        {children}
      </ViewportMenuSurface>
    </TransientLayerOwnerProvider>
  )
}
