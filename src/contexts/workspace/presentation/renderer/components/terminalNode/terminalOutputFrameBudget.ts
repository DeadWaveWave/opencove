type TerminalOutputDrainCallback = () => void

const MAX_DRAINS_PER_FRAME = 4
const MAX_DRAIN_FRAME_MS = 8

let nextDrainId = 1
let scheduledFrame: number | null = null
let isDrainingFrame = false
const queuedDrains: Array<{ id: number; callback: TerminalOutputDrainCallback }> = []
const canceledDrainIds = new Set<number>()

function scheduleFrame(): void {
  if (scheduledFrame !== null || isDrainingFrame || queuedDrains.length === 0) {
    return
  }

  scheduledFrame = window.requestAnimationFrame(() => {
    scheduledFrame = null
    isDrainingFrame = true
    const startedAt = performance.now()
    let processed = 0

    while (queuedDrains.length > 0 && processed < MAX_DRAINS_PER_FRAME) {
      if (performance.now() - startedAt > MAX_DRAIN_FRAME_MS) {
        break
      }

      const next = queuedDrains.shift()
      if (!next || canceledDrainIds.delete(next.id)) {
        continue
      }

      processed += 1
      next.callback()
    }

    isDrainingFrame = false
    if (queuedDrains.length > 0) {
      scheduleFrame()
    }
  })
}

export function scheduleTerminalOutputDrain(callback: TerminalOutputDrainCallback): number {
  const id = nextDrainId
  nextDrainId += 1
  queuedDrains.push({ id, callback })
  scheduleFrame()
  return id
}

export function cancelTerminalOutputDrain(id: number): void {
  canceledDrainIds.add(id)
}

export function resetTerminalOutputFrameBudgetForTests(): void {
  if (scheduledFrame !== null) {
    window.cancelAnimationFrame(scheduledFrame)
  }
  nextDrainId = 1
  scheduledFrame = null
  isDrainingFrame = false
  queuedDrains.length = 0
  canceledDrainIds.clear()
}
