import { vi } from 'vitest'

/** Advance only queued promises and timers created by the product. Never invoke owner helpers. */
export async function drainFaultMicrotasks(turns = 32): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await Promise.resolve()
  }
}

export async function waitForFaultTask(done: () => boolean, trace: () => string): Promise<void> {
  for (let turn = 0; turn < 1000 && !done(); turn++) {
    await Promise.resolve()
  }
  if (!done()) {
    throw new Error(`fallback model stalled\n${trace()}`)
  }
}

export async function drainFaultTimers(): Promise<void> {
  for (let timer = 0; timer < 20 && vi.getTimerCount() > 0; timer++) {
    await vi.advanceTimersToNextTimerAsync()
  }
}
