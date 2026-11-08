import React, { memo } from 'react'
import { classNames } from './classNames'
import { PIXEL_ICON_GRID, pixelIconRows, type PixelIconName } from './pixelIconArt'

/**
 * Pixel icons are drawn only at whole multiples of half their grid, so every cell lands on whole
 * device pixels at 2× (1, 1.5, 2 or 3 CSS pixels a cell). CSS that sizes an icon uses the matching
 * `--cove-icon-size-*` token; 36 is for a lone illustration, such as an unopenable file.
 */
export type PixelIconSize = 12 | 18 | 24 | 36

export type PixelIconProps = Omit<
  React.SVGProps<SVGSVGElement>,
  'children' | 'ref' | 'name' | 'width' | 'height' | 'viewBox' | 'fill' | 'stroke' | 'strokeWidth'
> & {
  size?: PixelIconSize
}

export type PixelIconComponent = React.NamedExoticComponent<PixelIconProps>

const paths = new Map<PixelIconName, string>()

/** One path of whole-cell runs, so an icon is a single element however much it paints. */
export function pixelIconPath(name: PixelIconName): string {
  const cached = paths.get(name)
  if (cached !== undefined) {
    return cached
  }
  let path = ''
  pixelIconRows(name).forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (row[x] !== '#') {
        x++
        continue
      }
      let width = 1
      while (row[x + width] === '#') {
        width++
      }
      path += `M${x} ${y}h${width}v1h-${width}z`
      x += width
    }
  })
  paths.set(name, path)
  return path
}

/**
 * A 12×12 pixel icon in `currentColor`, drawn with crisp edges (Tide: the app's icons are pixel
 * art). Decorative unless given a label: the control around it names what it does.
 */
export const PixelIcon = memo(function PixelIcon({
  name,
  size = 18,
  className,
  ...svgProps
}: PixelIconProps & { name: PixelIconName }): React.JSX.Element {
  const labelled = svgProps['aria-label'] !== undefined || svgProps['aria-labelledby'] !== undefined
  return (
    <svg
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      role={labelled ? 'img' : undefined}
      {...svgProps}
      className={classNames('cove-pixel-icon', className)}
      width={size}
      height={size}
      viewBox={`0 0 ${PIXEL_ICON_GRID} ${PIXEL_ICON_GRID}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      data-cove-pixel-icon={name}
    >
      <path d={pixelIconPath(name)} />
    </svg>
  )
})

/** A named icon component, for places that pass an icon around as a value. */
export function createPixelIcon(name: PixelIconName): PixelIconComponent {
  const Icon = memo(function Icon(props: PixelIconProps): React.JSX.Element {
    return <PixelIcon {...props} name={name} />
  })
  Icon.displayName = `PixelIcon(${name})`
  return Icon
}
