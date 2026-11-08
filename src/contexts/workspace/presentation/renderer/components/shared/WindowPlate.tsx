import type React from 'react'
import type { WindowKindFamily } from '../../utils/windowKindFamily'

/**
 * The solid reading plate a window body sits on (window-plate.css). It is one element under the
 * whole window, so its fade into the frame is one mask: separate edge tiles seam at fractional
 * canvas zoom. Windows with a reading body render it just before the body, in their kind's plate
 * colour. Terminals leave `kind` out: their own colour is their kind's plate (terminal-node.css).
 */
export function WindowPlate({ kind }: { kind?: WindowKindFamily }): React.JSX.Element {
  return (
    <div
      className="cove-window-plate"
      data-cove-part="window-plate"
      data-cove-kind={kind}
      aria-hidden="true"
    />
  )
}
