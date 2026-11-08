import React, { memo } from 'react'
import { classNames } from './classNames'
import type { PixelIconSize } from './PixelIcon'

/** The ring's eight 2×2 blocks on the 12×12 grid, clockwise from the top. */
const BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [5, 1],
  [8, 2],
  [9, 5],
  [8, 8],
  [5, 9],
  [2, 8],
  [1, 5],
  [2, 2],
]

/**
 * Busy, in pixels: eight blocks round a ring light up one after another. A pixel icon never
 * rotates, since a quarter turn off the grid smears it (ui-icons.css).
 */
export const PixelSpinner = memo(function PixelSpinner({
  size = 18,
  className,
  ...svgProps
}: Omit<
  React.SVGProps<SVGSVGElement>,
  'children' | 'ref' | 'width' | 'height' | 'viewBox' | 'fill'
> & { size?: PixelIconSize }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      {...svgProps}
      className={classNames('cove-pixel-icon', 'cove-pixel-spinner', className)}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      fill="currentColor"
      data-cove-pixel-icon="spinner"
    >
      {BLOCKS.map(([x, y], index) => (
        <rect
          key={`${x}:${y}`}
          className="cove-pixel-spinner__block"
          x={x}
          y={y}
          width={2}
          height={2}
          style={{ '--cove-pixel-spinner-step': index } as React.CSSProperties}
        />
      ))}
    </svg>
  )
})
