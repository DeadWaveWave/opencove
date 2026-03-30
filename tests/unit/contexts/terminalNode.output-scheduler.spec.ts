import { describe, expect, it, vi } from 'vitest'
import { createTerminalOutputScheduler } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/outputScheduler'

describe('terminal output scheduler', () => {
  it('tracks direct writes as pending until the write callback commits', () => {
    const writeCallbacks: Array<() => void> = []
    const terminal = {
      write: vi.fn((_data: string, callback?: () => void) => {
        if (callback) {
          writeCallbacks.push(callback)
        }
      }),
    }
    const onWriteCommitted = vi.fn()

    const scheduler = createTerminalOutputScheduler({
      terminal: terminal as never,
      scrollbackBuffer: { append: vi.fn() },
      markScrollbackDirty: vi.fn(),
      onWriteCommitted,
    })

    scheduler.handleChunk('FRAME_29999_TOKEN')

    expect(scheduler.hasPendingWrites()).toBe(true)
    expect(onWriteCommitted).not.toHaveBeenCalled()

    writeCallbacks.shift()?.()

    expect(onWriteCommitted).toHaveBeenCalledWith('FRAME_29999_TOKEN')
    expect(scheduler.hasPendingWrites()).toBe(false)
  })

  it('queues later chunks until the in-flight direct write completes', () => {
    const writeCallbacks: Array<() => void> = []
    const writes: string[] = []
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame

    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()

    try {
      const terminal = {
        write: vi.fn((data: string, callback?: () => void) => {
          writes.push(data)
          if (callback) {
            writeCallbacks.push(callback)
          }
        }),
      }

      const scheduler = createTerminalOutputScheduler({
        terminal: terminal as never,
        scrollbackBuffer: { append: vi.fn() },
        markScrollbackDirty: vi.fn(),
      })

      scheduler.handleChunk('FIRST')
      scheduler.handleChunk('SECOND')

      expect(writes).toEqual(['FIRST'])
      expect(scheduler.hasPendingWrites()).toBe(true)

      writeCallbacks.shift()?.()

      expect(writes).toEqual(['FIRST', 'SECOND'])

      writeCallbacks.shift()?.()

      expect(scheduler.hasPendingWrites()).toBe(false)
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })
})
