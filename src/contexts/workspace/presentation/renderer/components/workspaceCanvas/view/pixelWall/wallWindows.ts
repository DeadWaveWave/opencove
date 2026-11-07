import type { InternalNode, Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../../types'
import { resolveAgentPresentation } from '../../../../utils/agentPresentation'
import { resolveWindowKindFamily, type WindowKindFamily } from '../../../../utils/windowKindFamily'
import type { WallViewport } from './wallGrid'
import type { WallWindowRect } from './wallCells'
import { RIPPLE_WINDOW_INTERVAL_MS } from './ripples'
import type { WallLightPalette } from './wallPalette'
import {
  resolveWorkLight,
  resolveWorkLightState,
  workLightSeed,
  type WorkLightState,
} from './workLight'

interface TrackedWindow {
  id: string
  rect: Omit<WallWindowRect, 'light'>
  family: WindowKindFamily
  state: WorkLightState
  sessionId: string | null
  acceptsOutput: boolean
}

interface WindowEvents {
  running: boolean
  state: WorkLightState
  outputAt: number | null
  flashAt: number | null
  bornAt: number | null
  seed: number
}

export function isWindowOnScreen(
  rect: TrackedWindow['rect'],
  view: WallViewport,
  margin: number,
): boolean {
  const x = rect.x * view.zoom + view.x,
    y = rect.y * view.zoom + view.y
  return (
    x + rect.width * view.zoom >= -margin &&
    y + rect.height * view.zoom >= -margin &&
    x <= view.width + margin &&
    y <= view.height + margin
  )
}

/**
 * The windows the wall lights, and the moments their light reacts to: output from the PTY event
 * hub and a run finishing (working → standby, seen live; a reload never flares). Runtime only:
 * nothing here is stored or written back (I7).
 */
export function createWallWindowTracker(initialNodeIds?: Iterable<string>) {
  const initialIds = new Set(initialNodeIds)
  let firstSnapshot = initialNodeIds === undefined
  let windows: TrackedWindow[] = []
  const events = new Map<string, WindowEvents>()

  return {
    sync(nodeLookup: Map<string, InternalNode<Node<TerminalNodeData>>>, now: number): void {
      const next: TrackedWindow[] = []
      // A partial store (tests, first render) has no windows yet.
      for (const node of nodeLookup?.values() ?? []) {
        const width = node.measured?.width ?? node.width ?? 0
        const height = node.measured?.height ?? node.height ?? 0
        const { x, y } = node.internals.positionAbsolute
        const presentation = resolveAgentPresentation(node.data)
        const state = resolveWorkLightState(presentation.isAgent, presentation.status)
        const previous = events.get(node.id)
        if (!previous) {
          const restored =
            firstSnapshot ||
            initialIds.has(node.id) ||
            presentation.status === 'restoring' ||
            node.data.runtimeSessionBinding ||
            node.data.isLiveSessionReattach
          events.set(node.id, {
            state,
            running: presentation.status === 'running',
            outputAt: null,
            flashAt: null,
            bornAt: restored ? null : now,
            seed: workLightSeed(node.id),
          })
        } else {
          if (
            (previous.running && state === 'standby') ||
            (previous.state !== 'failed' && state === 'failed')
          ) {
            previous.flashAt = now
          }
          previous.state = state
          previous.running = presentation.status === 'running'
        }
        initialIds.delete(node.id)
        if (node.hidden || width <= 0 || height <= 0) {
          continue
        }
        next.push({
          id: node.id,
          rect: { x, y, width, height },
          family: resolveWindowKindFamily(node.data),
          state,
          sessionId: node.data.sessionId,
          // Agent message events (ACP) may drive output signals later; raw PTY repaints cannot.
          acceptsOutput: node.data.kind === 'terminal' && !presentation.isAgent,
        })
      }
      firstSnapshot = false
      const present = new Set(nodeLookup?.keys() ?? [])
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
    ): {
      id: string
      center: { x: number; y: number }
      family: WindowKindFamily
      rect: TrackedWindow['rect']
    } | null {
      if (!sessionId) {
        return null
      }
      const window = windows.find(candidate => candidate.sessionId === sessionId)
      const record = window ? events.get(window.id) : undefined
      if (
        !window?.acceptsOutput ||
        !record ||
        (record.outputAt !== null && now - record.outputAt < RIPPLE_WINDOW_INTERVAL_MS)
      ) {
        return null
      }
      record.outputAt = now
      const { x, y, width, height } = window.rect
      return {
        id: window.id,
        center: { x: x + width / 2, y: y + height / 2 },
        family: window.family,
        rect: window.rect,
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
    working(view?: WallViewport): Array<{
      id: string
      center: { x: number; y: number }
      family: WindowKindFamily
      rect: TrackedWindow['rect']
    }> {
      return windows
        .filter(
          window =>
            window.state === 'working' && (!view || isWindowOnScreen(window.rect, view, 200)),
        )
        .map(({ id, rect, family }) => ({
          id,
          rect,
          center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
          family,
        }))
    },
    /** Centres of the windows waiting for you, for their pulse rings. */
    waiting(
      view?: WallViewport,
    ): Array<{ id: string; center: { x: number; y: number }; rect: TrackedWindow['rect'] }> {
      return windows
        .filter(
          window =>
            window.state === 'waiting' && (!view || isWindowOnScreen(window.rect, view, 120)),
        )
        .map(({ id, rect }) => ({
          id,
          rect,
          center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        }))
    },
    /** Each window's frame and light for a clock in ms, or fixed levels for null. */
    resolve(
      now: number | null,
      palette: WallLightPalette,
    ): { windows: WallWindowRect[]; animating: boolean } {
      let animating = false
      // Disabling signals consumes transient energy, so enabling them never replays an old flash.
      if (now === null) {
        for (const record of events.values()) {
          record.outputAt = record.flashAt = record.bornAt = null
        }
      }
      const resolved = windows.map(window => {
        const record = events.get(window.id)
        const light = resolveWorkLight({
          state: window.state,
          now,
          outputAt: record?.outputAt ?? null,
          flashAt: record?.flashAt ?? null,
          bornAt: record?.bornAt ?? null,
          seed: record?.seed ?? 0,
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
