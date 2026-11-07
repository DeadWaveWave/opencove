/** Projects authoritative status onto frame chrome; no transition history or runtime state. */
export function createWindowStatusFrames() {
  const active = new Map<HTMLElement, HTMLElement | null>()
  function clear(element: HTMLElement) {
    active.get(element)?.remove()
    active.delete(element)
    delete element.dataset.coveWindowStatus
  }
  return {
    update(scope: ParentNode, windows: ReadonlyArray<{ id: string; status: string | null }>) {
      const present = new Set<HTMLElement>()
      for (const { id, status } of windows) {
        if (status !== 'waiting' && status !== 'failed') {
          continue
        }
        const element = scope.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(id)}"]`,
        )
        if (!element) {
          continue
        }
        present.add(element)
        if (element.dataset.coveWindowStatus === status) {
          continue
        }
        clear(element)
        element.dataset.coveWindowStatus = status
        let halo: HTMLElement | null = null
        if (status === 'waiting') {
          halo = document.createElement('div')
          halo.className = 'cove-window-halo'
          halo.setAttribute('aria-hidden', 'true')
          element.append(halo)
        }
        active.set(element, halo)
      }
      for (const element of active.keys()) {
        if (!present.has(element)) {
          clear(element)
        }
      }
    },
    clear() {
      for (const element of active.keys()) {
        clear(element)
      }
    },
  }
}
