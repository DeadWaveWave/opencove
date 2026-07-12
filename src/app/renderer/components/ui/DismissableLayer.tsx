import React from 'react'
import {
  claimOverlayLayerEvent,
  createOverlayLayerId,
  getOverlayBranches,
  isTopOverlayLayer,
  registerOverlayBranch,
  registerOverlayLayer,
  type OverlayLayerId,
} from './overlayLayerRegistry'

export type DismissableLayerDismissReason = 'escape' | 'pointer-down-outside'

export interface DismissableLayerProps extends React.HTMLAttributes<HTMLDivElement> {
  onDismiss: (reason: DismissableLayerDismissReason, event: KeyboardEvent | PointerEvent) => void
  dismissOnEscape?: boolean
  dismissOnPointerDownOutside?: boolean
  branchRefs?: readonly React.RefObject<HTMLElement | null>[]
}

const OverlayLayerContext = React.createContext<OverlayLayerId | null>(null)

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

function eventOccurredWithin(event: Event, element: HTMLElement | null): boolean {
  if (!element) {
    return false
  }

  if (typeof event.composedPath === 'function' && event.composedPath().includes(element)) {
    return true
  }

  return event.target instanceof Node && element.contains(event.target)
}

export function useOverlayBranch<T extends HTMLElement>(
  branchRef: React.RefObject<T | null>,
  enabled = true,
): void {
  const layerId = React.useContext(OverlayLayerContext)

  React.useLayoutEffect(() => {
    const branch = branchRef.current
    if (!enabled || layerId === null || !branch) {
      return
    }

    return registerOverlayBranch(layerId, branch)
  }, [branchRef, enabled, layerId])
}

export const DismissableLayer = React.forwardRef<HTMLDivElement, DismissableLayerProps>(
  function DismissableLayer(
    {
      onDismiss,
      dismissOnEscape = true,
      dismissOnPointerDownOutside = true,
      branchRefs = [],
      children,
      ...rest
    },
    forwardedRef,
  ): React.JSX.Element {
    const [layerId] = React.useState(createOverlayLayerId)
    const rootRef = React.useRef<HTMLDivElement | null>(null)
    const latestOptionsRef = React.useRef({ onDismiss, branchRefs })
    latestOptionsRef.current = { onDismiss, branchRefs }

    const setRefs = React.useCallback(
      (element: HTMLDivElement | null): void => {
        rootRef.current = element
        assignRef(forwardedRef, element)
      },
      [forwardedRef],
    )

    React.useLayoutEffect(() => registerOverlayLayer(layerId), [layerId])

    React.useEffect(() => {
      const ownerDocument = rootRef.current?.ownerDocument ?? document

      const eventIsInsideLayer = (event: Event): boolean => {
        if (eventOccurredWithin(event, rootRef.current)) {
          return true
        }

        const directBranches = latestOptionsRef.current.branchRefs
        if (directBranches.some(ref => eventOccurredWithin(event, ref.current))) {
          return true
        }

        return getOverlayBranches(layerId).some(branch => eventOccurredWithin(event, branch))
      }

      const handlePointerDown = (event: PointerEvent): void => {
        if (
          !dismissOnPointerDownOutside ||
          !isTopOverlayLayer(layerId) ||
          eventIsInsideLayer(event) ||
          !claimOverlayLayerEvent(layerId, event)
        ) {
          return
        }

        latestOptionsRef.current.onDismiss('pointer-down-outside', event)
      }

      const handleKeyDown = (event: KeyboardEvent): void => {
        if (!dismissOnEscape || event.key !== 'Escape' || !claimOverlayLayerEvent(layerId, event)) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        latestOptionsRef.current.onDismiss('escape', event)
      }

      ownerDocument.addEventListener('pointerdown', handlePointerDown, true)
      ownerDocument.addEventListener('keydown', handleKeyDown, true)

      return () => {
        ownerDocument.removeEventListener('pointerdown', handlePointerDown, true)
        ownerDocument.removeEventListener('keydown', handleKeyDown, true)
      }
    }, [dismissOnEscape, dismissOnPointerDownOutside, layerId])

    return (
      <OverlayLayerContext.Provider value={layerId}>
        <div {...rest} ref={setRefs}>
          {children}
        </div>
      </OverlayLayerContext.Provider>
    )
  },
)
