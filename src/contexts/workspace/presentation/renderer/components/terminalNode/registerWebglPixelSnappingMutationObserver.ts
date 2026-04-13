export function registerWebglPixelSnappingMutationObserver(input: {
  container: HTMLElement | null
  isWebglRenderer: () => boolean
  scheduleWebglPixelSnapping: () => void
}): () => void {
  const { container, isWebglRenderer, scheduleWebglPixelSnapping } = input

  if (!container || typeof MutationObserver === 'undefined') {
    return () => undefined
  }

  const reactFlowViewport =
    container.closest('.react-flow__viewport') instanceof HTMLElement
      ? (container.closest('.react-flow__viewport') as HTMLElement)
      : null
  const reactFlowNode =
    container.closest('.react-flow__node') instanceof HTMLElement
      ? (container.closest('.react-flow__node') as HTMLElement)
      : null

  if (!reactFlowViewport && !reactFlowNode) {
    return () => undefined
  }

  const observer = new MutationObserver(() => {
    if (!isWebglRenderer()) {
      return
    }

    scheduleWebglPixelSnapping()
  })

  if (reactFlowViewport) {
    observer.observe(reactFlowViewport, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  }

  if (reactFlowNode) {
    observer.observe(reactFlowNode, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  }

  return () => observer.disconnect()
}
