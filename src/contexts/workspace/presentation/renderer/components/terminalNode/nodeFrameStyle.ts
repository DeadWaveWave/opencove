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

  return {
    width: renderedFrame.size.width,
    height: renderedFrame.size.height,
    transform:
      renderedFrame.position.x !== position.x || renderedFrame.position.y !== position.y
        ? `translate(${renderedFrame.position.x - position.x}px, ${renderedFrame.position.y - position.y}px)`
        : undefined,
  }
}
