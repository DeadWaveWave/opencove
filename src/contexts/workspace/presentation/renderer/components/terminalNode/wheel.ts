export function shouldStopWheelPropagation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return true
  }

  const canvas = target.closest('.workspace-canvas')
  if (!(canvas instanceof HTMLElement)) {
    return true
  }

  const hoverPriority = canvas.dataset.canvasHoverPriority
  if (hoverPriority === 'traverse') {
    const node = target.closest('.react-flow__node')
    if (
      node instanceof HTMLElement &&
      document.activeElement instanceof HTMLElement &&
      node.contains(document.activeElement)
    ) {
      return true
    }
    return false
  }
  if (hoverPriority === 'interact') {
    return true
  }

  return canvas.dataset.canvasInputMode !== 'trackpad'
}
