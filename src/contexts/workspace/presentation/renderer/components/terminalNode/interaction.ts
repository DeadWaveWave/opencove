interface TerminalNodeInteraction {
  normalizeViewport: boolean
  selectNode: boolean
}

export function resolveTerminalNodeInteraction(
  target: EventTarget | null,
): TerminalNodeInteraction | null {
  if (!(target instanceof Element)) {
    return null
  }

  if (target.closest('.terminal-node__resizer')) {
    return null
  }

  if (target.closest('.terminal-node__terminal')) {
    if (target.closest('button, input, select, a')) {
      return null
    }

    return {
      normalizeViewport: true,
      selectNode: false,
    }
  }

  if (target.closest('button, input, textarea, select, a')) {
    return null
  }

  return {
    normalizeViewport: false,
    selectNode: true,
  }
}
