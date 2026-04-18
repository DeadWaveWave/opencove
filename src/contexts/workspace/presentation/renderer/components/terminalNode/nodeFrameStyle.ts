import type { NodeFrame, Point } from '../../types'

export function resolveTerminalNodeFrameStyle({
  draftFrame,
  position,
  width,
  height,
}: {
  draftFrame: NodeFrame | null
  position: Point
  width: number
  height: number
}): {
  width: number
  height: number
  transform?: string
} {
  const renderedFrame = draftFrame ?? {
    position,
    size: { width, height },
  }

  const translateX = Math.round(renderedFrame.position.x - position.x)
  const translateY = Math.round(renderedFrame.position.y - position.y)

  return {
    width: Math.round(renderedFrame.size.width),
    height: Math.round(renderedFrame.size.height),
    transform:
      translateX !== 0 || translateY !== 0
        ? `translate(${translateX}px, ${translateY}px)`
        : undefined,
  }
}
