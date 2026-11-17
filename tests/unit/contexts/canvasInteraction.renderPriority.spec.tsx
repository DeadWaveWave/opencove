import React, { useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasInteractionState } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.interaction'
import type { CanvasInteractionCommands } from '../../../src/contexts/workspace/presentation/renderer/store/canvasStore.interaction'
import {
  CanvasStoreProvider,
  useCanvasInteraction,
  useCanvasInteractionCommands,
} from '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext'

// #738, "Render priority": every subscriber of the `interaction` slice renders a gesture frame at
// the priority of the write that made it. A write from an animation frame renders after the frame
// (default priority), as the canvas's own `setState` calls do today; a write from a discrete event
// renders in that event's batch. A subscription through `useStore` (`useSyncExternalStore`) would
// render the frame's write in a microtask, inside the frame: arm A, which S6 does not ship.
// jsdom has one thread and no paint, so what these tests pin is the lane: a microtask turn is
// enough to show a sync-priority render and not enough to show a default-priority one.

const selectMagneticSnappingEnabled = (interaction: CanvasInteractionState) =>
  interaction.magneticSnappingEnabled

interface Harness {
  renders: boolean[]
  commands: CanvasInteractionCommands | null
}

function Subscriber({ harness }: { harness: Harness }): React.JSX.Element {
  const enabled = useCanvasInteraction(selectMagneticSnappingEnabled)
  const commands = useCanvasInteractionCommands()
  harness.renders.push(enabled)
  useEffect(() => {
    harness.commands = commands
  }, [commands, harness])
  return (
    <button type="button" onClick={() => commands.toggleMagneticSnapping()}>
      {String(enabled)}
    </button>
  )
}

const microtasks = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
  }
}

describe('interaction subscribers: render priority', () => {
  let frames: Array<() => void> = []
  let previousActEnvironment: boolean | undefined

  beforeEach(() => {
    frames = []
    previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT
    // The writes below must run outside `act`, which would flush every lane at once.
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(() => callback(0))
      return frames.length
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      previousActEnvironment
  })

  function mount(): { harness: Harness; button: () => HTMLButtonElement } {
    const harness: Harness = { renders: [], commands: null }
    const view = render(
      <CanvasStoreProvider workspaceId="priority">
        <Subscriber harness={harness} />
      </CanvasStoreProvider>,
    )
    expect(harness.commands).not.toBeNull()
    return { harness, button: () => view.getByRole('button') as HTMLButtonElement }
  }

  it('renders a write made in an animation-frame callback after the frame, not in a microtask', async () => {
    const { harness } = mount()
    const rendersBefore = harness.renders.length
    window.requestAnimationFrame(() => harness.commands?.toggleMagneticSnapping())

    // What the browser does: it calls the callback; nothing else is on the stack.
    frames.shift()?.()
    expect(harness.renders).toHaveLength(rendersBefore)
    await microtasks()
    expect(harness.renders).toHaveLength(rendersBefore)

    await waitFor(() => expect(harness.renders.length).toBeGreaterThan(rendersBefore))
    expect(harness.renders.at(-1)).toBe(false)
  })

  it('renders a write made in a discrete event in that event, before any task', async () => {
    const { harness, button } = mount()
    const rendersBefore = harness.renders.length

    button().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await microtasks()

    expect(harness.renders.length).toBeGreaterThan(rendersBefore)
    expect(harness.renders.at(-1)).toBe(false)
  })
})
