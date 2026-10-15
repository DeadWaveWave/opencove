import React from 'react'
import { classNames } from './classNames'

/**
 * solid: opaque, for dialogs and anything read for long.
 * glass: pre-composited translucency over the canvas, without blur.
 * acrylic: tinted real blur with grain, for short-lived overlays such as menus and popovers.
 * Glass and acrylic turn solid when the system asks to reduce transparency.
 */
export type SurfaceMaterial = 'solid' | 'glass' | 'acrylic'

/** Material attributes for components that render their own element, such as Popover. */
export function surfaceProps(
  material: SurfaceMaterial,
  className?: string,
): { className: string; 'data-material': SurfaceMaterial } {
  return { className: classNames('cove-surface', className), 'data-material': material }
}

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  material: SurfaceMaterial
}

/** The one place materials are applied, so their recipe and fallbacks stay consistent. */
export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { material, className, ...divProps },
  forwardedRef,
) {
  return (
    <div
      {...divProps}
      {...surfaceProps(material, className)}
      ref={forwardedRef}
      data-cove-part="surface"
    />
  )
})
