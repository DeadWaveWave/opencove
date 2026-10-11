import { readThemeEffect } from '@contexts/plugins/presentation/renderer/themeMotion'
import type { PluginThemeEffect } from '@contexts/plugins/domain/pluginThemeMotion'
import type { PixelNode, PixelViewport } from './model'
import type { PixelNodeFrame, PixelRect } from './geometry'
import type { PixelLayerOptions } from './options'

type Slot = 'background' | 'creation' | 'closing' | 'working'
interface Entry {
  element: HTMLElement
  animation: Animation | null
  dispose: () => void
}

const DEFAULTS: Record<Slot, { duration: number; frames: Keyframe[] }> = {
  background: { duration: 8000, frames: [{ opacity: 0.45 }, { opacity: 0.8 }, { opacity: 0.45 }] },
  creation: {
    duration: 380,
    frames: [
      { opacity: 0, transform: 'scale(0.97)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
  },
  closing: {
    duration: 420,
    frames: [
      { opacity: 0.8, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.96)' },
    ],
  },
  working: { duration: 1400, frames: [{ opacity: 0.2 }, { opacity: 0.85 }, { opacity: 0.2 }] },
}

/** Decorative slots never clone runtime content or own node positions / lifetime. */
export function createThemeEffects(scope: HTMLElement) {
  const layers = new Map<boolean, HTMLDivElement>()
  const entries = new Map<string, Entry>()
  const creations = new Map<string, Entry>()
  let disposed = false

  const layer = (foreground: boolean) => {
    let element = layers.get(foreground)
    if (!element) {
      element = document.createElement('div')
      element.dataset.covePart = 'effect-layer'
      element.setAttribute('aria-hidden', 'true')
      Object.assign(element.style, {
        position: 'absolute',
        inset: '0',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: foreground ? '5' : '0',
      })
      scope.append(element)
      layers.set(foreground, element)
    }
    return element
  }

  const animate = (
    element: HTMLElement,
    slot: Slot,
    effect: PluginThemeEffect,
    loop: boolean,
    endpoint?: Keyframe,
  ) => {
    try {
      if (typeof element.animate !== 'function') {
        return null
      }
      const frames: Keyframe[] = (effect.keyframes ?? DEFAULTS[slot].frames).map(frame => ({
        ...frame,
      }))
      if (endpoint) {
        const last = frames[frames.length - 1]
        if (typeof last.offset === 'number' && last.offset < 1) {
          frames.push({ ...endpoint, offset: 1 })
        } else {
          frames[frames.length - 1] = { ...last, ...endpoint, offset: 1 }
        }
      }
      return element.animate(frames, {
        duration: effect.durationMs ?? DEFAULTS[slot].duration,
        easing: effect.easing ?? 'ease-in-out',
        iterations: loop ? Infinity : 1,
        fill: 'both',
      })
    } catch {
      // Invalid/unsupported decorative CSS must never prevent revealing a real window.
      return null
    }
  }

  const slotEntry = (key: string, slot: Slot, rect: PixelRect, nodeId?: string) => {
    let entry = entries.get(key)
    if (!entry) {
      const element = document.createElement('div')
      element.dataset.covePart = `effect-${slot}`
      if (nodeId) {
        element.dataset.coveNodeId = nodeId
      }
      Object.assign(element.style, {
        position: 'absolute',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      })
      element.style.setProperty(
        '--cove-effect-duration',
        `${readThemeEffect(slot).durationMs ?? DEFAULTS[slot].duration}ms`,
      )
      layer(slot !== 'background').append(element)
      const animation = animate(
        element,
        slot,
        slot === 'creation' && !readThemeEffect(slot).keyframes
          ? {
              ...readThemeEffect(slot),
              keyframes: [{ opacity: 0 }, { opacity: 0.65, offset: 0.35 }, { opacity: 0 }],
            }
          : readThemeEffect(slot),
        slot === 'background' || slot === 'working',
        slot === 'creation' || slot === 'closing' ? { opacity: 0 } : undefined,
      )
      if (animation) {
        void animation.finished.catch(() => {})
      }
      entry = {
        element,
        animation,
        dispose: () => {
          animation?.cancel()
          element.remove()
        },
      }
      entries.set(key, entry)
    }
    Object.assign(entry.element.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  }

  const clearEntries = () => {
    entries.forEach(entry => entry.dispose())
    entries.clear()
  }
  const reveal = (id: string) => {
    creations.get(id)?.dispose()
    creations.delete(id)
  }
  const clear = () => {
    clearEntries()
    creations.forEach(entry => entry.dispose())
    creations.clear()
    layers.forEach(element => element.remove())
    layers.clear()
  }

  return {
    startCreation(id: string, presentation?: HTMLElement) {
      if (disposed) {
        return
      }
      reveal(id)
      const node = scope.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(id)}"]`,
      )
      // Never animate React Flow's position transform or resize an editor / PTY.
      const element =
        presentation ??
        node?.querySelector<HTMLElement>('.cove-node-presentation') ??
        node?.firstElementChild
      if (!(element instanceof HTMLElement)) {
        return
      }
      // Capture steady-state styles before the transient marker can affect the cascade.
      // Animation completion always converges here, then cancel releases ownership.
      const resting = getComputedStyle(element)
      const endpoint: Keyframe = {
        opacity: resting.opacity || '1',
        transform: resting.transform || 'none',
        filter: resting.filter || 'none',
        clipPath: resting.clipPath || 'none',
      }
      element.dataset.coveEffect = 'creation'
      const animation = animate(element, 'creation', readThemeEffect('creation'), false, endpoint)
      if (!animation) {
        delete element.dataset.coveEffect
        return
      }
      const entry: Entry = {
        element,
        animation,
        dispose: () => {
          animation.cancel()
          delete element.dataset.coveEffect
        },
      }
      creations.set(id, entry)
      const finish = () => {
        if (creations.get(id) !== entry) {
          return
        }
        reveal(id)
      }
      void animation.finished.then(finish, finish)
    },
    sync(
      viewport: PixelViewport,
      nodes: PixelNode[],
      creating: PixelNodeFrame[],
      closing: PixelNodeFrame[],
      options: PixelLayerOptions,
      reducedMotion: boolean,
    ) {
      if (disposed) {
        return
      }
      const wanted = new Set<string>()
      const add = (key: string, slot: Slot, rect: PixelRect, nodeId?: string) => {
        wanted.add(key)
        slotEntry(key, slot, rect, nodeId)
      }
      if (!reducedMotion) {
        if (options.background && readThemeEffect('background').preset === 'custom') {
          add('background', 'background', {
            x: 0,
            y: 0,
            width: viewport.width,
            height: viewport.height,
          })
        }
        if (options.working && readThemeEffect('working').preset === 'custom') {
          for (const node of nodes
            .filter(candidate => candidate.tone === 'working')
            .slice(0, 128)) {
            add(`working:${node.id}`, 'working', node.rect, node.id)
          }
        }
        for (const [slot, frames] of [
          ['creation', creating],
          ['closing', closing],
        ] as const) {
          if (!options[slot] || readThemeEffect(slot).preset !== 'custom') {
            continue
          }
          for (const frame of frames) {
            add(`${slot}:${frame.id}`, slot, frame.rect, frame.id)
          }
        }
      }
      for (const [key, entry] of entries) {
        if (!wanted.has(key)) {
          entry.dispose()
          entries.delete(key)
        }
      }
      const visibleCreationIds = new Set(creating.map(frame => frame.id))
      for (const id of creations.keys()) {
        if (!options.creation || reducedMotion || !visibleCreationIds.has(id)) {
          reveal(id)
        }
      }
    },
    reveal,
    clear,
    dispose() {
      disposed = true
      clear()
    },
  }
}
