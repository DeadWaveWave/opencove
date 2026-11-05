import type { InternalNode, Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../../types'
import { resolveAgentPresentation } from '../../../../utils/agentPresentation'
import { resolveWindowKindFamily, type WindowKindFamily } from '../../../../utils/windowKindFamily'
import type { WallWindowRect } from './wallCells'
import type { WallLightPalette } from './wallPalette'
import { resolveWorkLight, resolveWorkLightState, type WorkLightState } from './workLight'

interface TrackedWindow {
  id: string
  rect: Omit<WallWindowRect, 'light'>
  family: WindowKindFamily
  state: WorkLightState
  sessionId: string | null
}

interface WindowEvents {
  state: WorkLightState
  outputAt: number | null
  completedAt: number | null
}

/**
 * The windows the wall lights, and the moments their light reacts to: output from the PTY event
 * hub and a run finishing (working → standby, seen live; a reload never flares). Runtime only:
 * nothing here is stored or written back (I7).
 */
export function createWallWindowTracker() {
  let windows: TrackedWindow[] = []
  const events = new Map<string, WindowEvents>()

  return {
    sync(nodeLookup: Map<string, InternalNode<Node<TerminalNodeData>>>, now: number): void {
      const next: TrackedWindow[] = []
      // A partial store (tests, first render) has no windows yet.
      for (const node of nodeLookup?.values() ?? []) {
        const width = node.measured?.width ?? node.width ?? 0
        const height = node.measured?.height ?? node.height ?? 0
        if (node.hidden || width <= 0 || height <= 0) {
          continue
        }
        const { x, y } = node.internals.positionAbsolute
        const presentation = resolveAgentPresentation(node.data)
        const state = resolveWorkLightState(presentation.isAgent, presentation.status)
        const previous = events.get(node.id)
        if (!previous) {
          events.set(node.id, { state, outputAt: null, completedAt: null })
        } else if (previous.state !== state) {
          if (previous.state === 'working' && state === 'standby') {
            previous.completedAt = now
          }
          previous.state = state
        }
        next.push({
          id: node.id,
          rect: { x, y, width, height },
          family: resolveWindowKindFamily(node.data),
          state,
          sessionId: node.data.sessionId,
        })
      }
      const present = new Set(next.map(window => window.id))
      for (const id of events.keys()) {
        if (!present.has(id)) {
          events.delete(id)
        }
      }
      windows = next
    },
    /** Records output and returns the window that produced it, or null for another session. */
    observeOutput(
      sessionId: string,
      now: number,
    ): { id: string; center: { x: number; y: number }; family: WindowKindFamily } | null {
      if (!sessionId) {
        return null
      }
      const window = windows.find(candidate => candidate.sessionId === sessionId)
      const record = window ? events.get(window.id) : undefined
      if (!window || !record) {
        return null
      }
      record.outputAt = now
      const { x, y, width, height } = window.rect
      return {
        id: window.id,
        center: { x: x + width / 2, y: y + height / 2 },
        family: window.family,
      }
    },
    /** A window's centre, frame and kind, for the waves it sends. */
    find(id: string): {
      center: { x: number; y: number }
      rect: TrackedWindow['rect']
      family: WindowKindFamily
    } | null {
      const window = windows.find(candidate => candidate.id === id)
      if (!window) {
        return null
      }
      const { x, y, width, height } = window.rect
      return {
        center: { x: x + width / 2, y: y + height / 2 },
        rect: window.rect,
        family: window.family,
      }
    },
    /** Every window's frame, for the shockwave's sweep. */
    frames(): Array<{ id: string; rect: TrackedWindow['rect'] }> {
      return windows.map(({ id, rect }) => ({ id, rect }))
    },
    /** Working agents' centres and kinds, for their sonar waves. */
    working(): Array<{ id: string; center: { x: number; y: number }; family: WindowKindFamily }> {
      return windows
        .filter(window => window.state === 'working')
        .map(({ id, rect, family }) => ({
          id,
          center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
          family,
        }))
    },
    /** Centres of the windows waiting for you, for their pulse rings. */
    waiting(): Array<{ id: string; center: { x: number; y: number } }> {
      return windows
        .filter(window => window.state === 'waiting')
        .map(({ id, rect }) => ({
          id,
          center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        }))
    },
    /** Each window's frame and light for a clock in ms, or fixed levels for null. */
    resolve(
      now: number | null,
      palette: WallLightPalette,
    ): { windows: WallWindowRect[]; animating: boolean } {
      let animating = false
      const resolved = windows.map(window => {
        const record = events.get(window.id)
        const light = resolveWorkLight({
          state: window.state,
          now,
          outputAt: record?.outputAt ?? null,
          completedAt: record?.completedAt ?? null,
        })
        animating ||= light.animating
        const color = light.tone === 'kind' ? palette[window.family] : palette[light.tone]
        return {
          ...window.rect,
          light: { color, intensity: light.intensity },
          active: window.state === 'working' || window.state === 'waiting',
        }
      })
      return { windows: resolved, animating }
    },
  }
}
