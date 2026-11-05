import type { AgentRuntimeStatus } from '@contexts/agent/domain/types'
import { resolveWorkLightState, type WorkLightState } from '../pixelWall/workLight'

/** A window flares for a finished run at most once per three seconds (Tide signals). */
export const COMPLETION_COOLDOWN_MS = 3000

export type WindowSignalKind = 'complete' | 'fail'

/**
 * Turns agent state into the moments worth a signal: a run finishing (working → standby) and a
 * failure (any change into failed). Only transitions seen live count: a window seen for the first
 * time, as after a reload, never signals. Runtime only.
 */
export function createWindowSignalDetector() {
  const seen = new Map<string, { state: WorkLightState; completedAt: number }>()

  return {
    observe(
      windows: ReadonlyArray<{
        id: string
        isAgent: boolean
        status: AgentRuntimeStatus | string | null
      }>,
      now: number,
    ): Array<{ id: string; kind: WindowSignalKind }> {
      const signals: Array<{ id: string; kind: WindowSignalKind }> = []
      const present = new Set<string>()
      for (const window of windows) {
        if (!window.isAgent) {
          continue
        }
        present.add(window.id)
        const state = resolveWorkLightState(true, window.status as AgentRuntimeStatus | null)
        const previous = seen.get(window.id)
        if (!previous) {
          seen.set(window.id, { state, completedAt: -Infinity })
          continue
        }
        if (previous.state === state) {
          continue
        }
        if (state === 'failed') {
          signals.push({ id: window.id, kind: 'fail' })
        } else if (
          previous.state === 'working' &&
          state === 'standby' &&
          now - previous.completedAt >= COMPLETION_COOLDOWN_MS
        ) {
          previous.completedAt = now
          signals.push({ id: window.id, kind: 'complete' })
        }
        previous.state = state
      }
      for (const id of seen.keys()) {
        if (!present.has(id)) {
          seen.delete(id)
        }
      }
      return signals
    },
  }
}
