import type React from 'react'

/**
 * The solid reading plate a window body sits on (window-plate.css). It is one element under the
 * whole window, so its fade into the frame is one mask: separate edge tiles seam at fractional
 * canvas zoom. Windows with a reading body render it just before the body.
 */
export function WindowPlate(): React.JSX.Element {
  return <div className="cove-window-plate" data-cove-part="window-plate" aria-hidden="true" />
}
