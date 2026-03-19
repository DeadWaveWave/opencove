export function shouldFocusNodeFromClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true
  }

  if (target.closest('[data-node-drag-handle=true]')) {
    return false
  }

  if (target.closest('.nodrag')) {
    return false
  }

  if (target.closest('.terminal-node__terminal')) {
    return false
  }

  if (target.closest('button')) {
    return false
  }

  return true
}

export function isPanePointerDragStartTarget(target: EventTarget | null): target is Element {
  return Boolean(
    target instanceof Element &&
    !target.closest('.react-flow__node') &&
    (target.closest('.react-flow__pane') ||
      target.closest('.react-flow__renderer') ||
      target.closest('.react-flow__background')),
  )
}

export function isCanvasDoubleClickCreateTarget(target: EventTarget | null): target is Element {
  if (!(target instanceof Element)) {
    return false
  }

  const isFlowClickTarget =
    target.closest('.react-flow__pane') ||
    target.closest('.react-flow__renderer') ||
    target.closest('.react-flow__background')
  if (!isFlowClickTarget) {
    return false
  }

  if (
    target.closest('.react-flow__node') ||
    target.closest('.react-flow__panel') ||
    target.closest('.react-flow__minimap') ||
    target.closest('.react-flow__controls') ||
    target.closest('.workspace-space-region__label-group') ||
    target.closest('.workspace-space-region__drag-handle') ||
    target.closest('button, input, textarea, select, a')
  ) {
    return false
  }

  return true
}
