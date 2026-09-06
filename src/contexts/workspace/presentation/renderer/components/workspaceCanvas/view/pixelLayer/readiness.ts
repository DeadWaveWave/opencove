import type { PixelNodeFrame } from './geometry'

/** Begin with the visible node frame. PTY/editor/media loading runs independently of its reveal. */
export function readReadyPixelNodeIds(
  scope: HTMLElement,
  frames: readonly PixelNodeFrame[],
): string[] {
  return frames.flatMap(frame => {
    const node = scope.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${CSS.escape(frame.id)}"]`,
    )
    if (!node || !node.isConnected || getComputedStyle(node).visibility === 'hidden') {
      return []
    }
    return [frame.id]
  })
}
