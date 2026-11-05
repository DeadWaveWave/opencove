import React, { memo } from 'react'
import { classNames } from './classNames'
import { pixelGlyphRuns, type PixelGlyphName } from './pixelGlyphs'

/**
 * A 9×9 pixel icon in `currentColor`, drawn with crisp edges (Tide: colour always comes with a
 * pixel icon). Decorative: the surrounding title or label names what it shows.
 */
export const PixelGlyph = memo(function PixelGlyph({
  name,
  className,
  ...data
}: {
  name: PixelGlyphName
  className?: string
} & { [key: `data-${string}`]: string | undefined }): React.JSX.Element {
  return (
    <svg
      className={classNames('cove-pixel-glyph', className)}
      viewBox="0 0 9 9"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-cove-pixel-glyph={name}
      {...data}
    >
      {pixelGlyphRuns(name).map(run => (
        <rect key={`${run.x}:${run.y}`} x={run.x} y={run.y} width={run.width} height={1} />
      ))}
    </svg>
  )
})
