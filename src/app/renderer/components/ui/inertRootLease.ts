interface InertRootState {
  owners: number
  originalAttribute: string | null
}

const inertRoots = new WeakMap<HTMLElement, InertRootState>()

export function acquireInertRootLease(element: HTMLElement): () => void {
  let state = inertRoots.get(element)
  if (!state) {
    state = { owners: 0, originalAttribute: element.getAttribute('inert') }
    inertRoots.set(element, state)
    element.setAttribute('inert', '')
  }
  state.owners += 1
  let released = false

  return () => {
    if (released) {
      return
    }
    released = true
    state.owners -= 1
    if (state.owners > 0) {
      return
    }

    inertRoots.delete(element)
    if (state.originalAttribute === null) {
      element.removeAttribute('inert')
    } else {
      element.setAttribute('inert', state.originalAttribute)
    }
  }
}
