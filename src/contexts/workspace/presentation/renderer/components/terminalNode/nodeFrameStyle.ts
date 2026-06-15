import type { NodeFrame, Point } from '../../types'

export function resolveTerminalNodeFrameStyle({
  draftFrame,
  position,
  width,
  height,
}: {
  draftFrame: NodeFrame | null
  position: Point | null
  width: number
  height: number
}): {
  width: number
  height: number
  transform?: string
} {
  if (!draftFrame || !position) {
    return {
      width: Math.round(width),
      height: Math.round(height),
    }
  }

  const translateX = Math.round(draftFrame.position.x - position.x)
  const translateY = Math.round(draftFrame.position.y - position.y)

  return {
    width: Math.round(draftFrame.size.width),
    height: Math.round(draftFrame.size.height),
    transform:
      translateX !== 0 || translateY !== 0
        ? `translate(${translateX}px, ${translateY}px)`
        : undefined,
  }
}
