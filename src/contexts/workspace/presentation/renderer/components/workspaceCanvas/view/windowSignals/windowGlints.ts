import type { Ripple } from '../pixelWall/ripples'

interface WindowFrame {
  id: string
  rect: { x: number; y: number; width: number; height: number }
}

/** Tide updateCatch (1923–1938): the window's short side widens the receiving rim's band. */
export function resolveWindowGlint({ id, rect }: WindowFrame, waves: readonly Ripple[]) {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const half = Math.min(rect.width, rect.height) / 2
  let intensity = 0
  let color = ''
  for (const wave of waves) {
    if (!wave.sweep || wave.sourceId === id) {
      continue
    }
    const x = (Math.hypot(cx - wave.x, cy - wave.y) - wave.radius) / (wave.band + half)
    if (Math.abs(x) > 2.6) {
      continue
    }
    const value = wave.strength * Math.exp(-x * x)
    if (value > intensity) {
      intensity = value
      color = wave.glint ?? `rgb(${wave.color.join(' ')})`
    }
  }
  return { intensity: intensity < 0.02 ? 0 : intensity, color }
}

/** Owns only a masked rim element and its variables; no animation timer or frame fill changes. */
export function createWindowGlints(getScope: () => ParentNode) {
  const active = new Map<
    string,
    {
      element: HTMLElement
      rim: HTMLElement
      intensity: number
      color: string
    }
  >()
  const remove = (id: string) => {
    const entry = active.get(id)
    if (!entry) {
      return
    }
    entry.element.style.setProperty('--cove-catch', '0')
    entry.element.style.removeProperty('--cove-glint')
    delete entry.element.dataset.coveSwept
    entry.rim.remove()
    active.delete(id)
  }
  return {
    update(frames: readonly WindowFrame[], waves: readonly Ripple[]) {
      const seen = new Set<string>()
      const scope = getScope()
      for (const frame of frames) {
        const glint = resolveWindowGlint(frame, waves)
        if (!glint.intensity) {
          continue
        }
        let entry = active.get(frame.id)
        if (entry && !scope.contains(entry.element)) {
          remove(frame.id)
          entry = undefined
        }
        if (!entry) {
          const element = scope.querySelector<HTMLElement>(
            `.react-flow__node[data-id="${CSS.escape(frame.id)}"]`,
          )
          if (!element) {
            continue
          }
          const rim = document.createElement('div')
          rim.className = 'cove-window-glint'
          rim.setAttribute('aria-hidden', 'true')
          element.append(rim)
          element.dataset.coveSwept = 'true'
          entry = { element, rim, intensity: 0, color: '' }
          active.set(frame.id, entry)
        }
        seen.add(frame.id)
        if (entry.color !== glint.color) {
          entry.color = glint.color
          entry.element.style.setProperty('--cove-glint', glint.color)
        }
        if (Math.abs(glint.intensity - entry.intensity) > 0.025) {
          entry.intensity = glint.intensity
          entry.element.style.setProperty('--cove-catch', glint.intensity.toFixed(3))
        }
      }
      for (const id of active.keys()) {
        if (!seen.has(id)) {
          remove(id)
        }
      }
    },
    clear() {
      for (const id of active.keys()) {
        remove(id)
      }
    },
  }
}
