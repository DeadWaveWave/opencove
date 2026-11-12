/** The point `distance` px along a rect's perimeter, clockwise from its top left corner. */
export function pointOnFrame(
  rect: { x: number; y: number; width: number; height: number },
  distance: number,
): { x: number; y: number } {
  const { x, y, width, height } = rect
  const perimeter = 2 * (width + height)
  let d = ((distance % perimeter) + perimeter) % perimeter
  if (d < width) {
    return { x: x + d, y }
  }
  d -= width
  if (d < height) {
    return { x: x + width, y: y + d }
  }
  d -= height
  if (d < width) {
    return { x: x + width - d, y: y + height }
  }
  return { x, y: y + height - (d - width) }
}
