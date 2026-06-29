import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminalOutputScheduler } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/outputScheduler'
import {
  beginTerminalGeometryCommit,
  markTerminalGeometryAccepted,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'
import { resetTerminalOutputFrameBudgetForTests } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalOutputFrameBudget'

function installAnimationFrameHarness() {
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame
  const frameCallbacks = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId
    nextFrameId += 1
    frameCallbacks.set(id, callback)
    return id
  })
  window.cancelAnimationFrame = vi.fn((id: number) => {
    frameCallbacks.delete(id)
  })

  return {
    runNextFrame: () => {
      const [id, callback] = frameCallbacks.entries().next().value ?? []
      if (typeof id !== 'number' || !callback) {
        return false
      }
      frameCallbacks.delete(id)
      callback(performance.now())
      return true
    },
    restore: () => {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    },
  }
}

describe('terminal output scheduler', () => {
  afterEach(() => {
    resetTerminalOutputFrameBudgetForTests()
    vi.restoreAllMocks()
  })

  it('tracks scheduled writes as pending until the write callback commits', () => {
    const frameHarness = installAnimationFrameHarness()
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

    expect(frameHarness.runNextFrame()).toBe(true)
    writeCallbacks.shift()?.()

    expect(onWriteCommitted).toHaveBeenCalledWith('FRAME_29999_TOKEN')
    expect(scheduler.hasPendingWrites()).toBe(false)
    frameHarness.restore()
  })

  it('queues later chunks until the in-flight direct write completes', () => {
    const frameHarness = installAnimationFrameHarness()
    const writeCallbacks: Array<() => void> = []
    const writes: string[] = []

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
    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['FIRST'])

    scheduler.handleChunk('SECOND')
    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['FIRST'])
    expect(scheduler.hasPendingWrites()).toBe(true)

    writeCallbacks.shift()?.()
    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['FIRST', 'SECOND'])

    writeCallbacks.shift()?.()
    expect(scheduler.hasPendingWrites()).toBe(false)
    frameHarness.restore()
  })

  it('preserves forced viewport drains requested while a write is in flight', () => {
    const frameHarness = installAnimationFrameHarness()
    const writeCallbacks: Array<() => void> = []
    const writes: string[] = []

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
      options: {
        maxPendingChars: 1,
        viewportInteractionWriteChunkChars: 64_000,
      },
    })

    scheduler.handleChunk('FIRST')
    expect(frameHarness.runNextFrame()).toBe(true)
    scheduler.onViewportInteractionActiveChange(true)
    scheduler.handleChunk('SECOND')

    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['FIRST'])

    writeCallbacks.shift()?.()
    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['FIRST', 'SECOND'])

    scheduler.dispose()
    frameHarness.restore()
  })

  it('limits terminal drains per animation frame across scheduler instances', () => {
    const frameHarness = installAnimationFrameHarness()
    const writes: string[] = []

    const schedulers = Array.from({ length: 6 }, () =>
      createTerminalOutputScheduler({
        terminal: {
          write: vi.fn((data: string) => {
            writes.push(data)
          }),
        } as never,
        scrollbackBuffer: { append: vi.fn() },
        markScrollbackDirty: vi.fn(),
        options: { normalWriteChunkChars: 64_000 },
      }),
    )

    schedulers.forEach((scheduler, index) => scheduler.handleChunk(`T${index}`))

    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['T0', 'T1', 'T2', 'T3'])

    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5'])

    schedulers.forEach(scheduler => scheduler.dispose())
    frameHarness.restore()
  })

  it('coalesces chunks that arrive before the scheduled frame', () => {
    const frameHarness = installAnimationFrameHarness()
    const writes: string[] = []

    const scheduler = createTerminalOutputScheduler({
      terminal: {
        write: vi.fn((data: string) => {
          writes.push(data)
        }),
      } as never,
      scrollbackBuffer: { append: vi.fn() },
      markScrollbackDirty: vi.fn(),
    })

    scheduler.handleChunk('FIRST')
    scheduler.handleChunk('SECOND')

    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['FIRSTSECOND'])

    scheduler.dispose()
    frameHarness.restore()
  })

  it('waits for pending geometry to be accepted before writing terminal output', () => {
    const frameHarness = installAnimationFrameHarness()
    const writes: string[] = []
    const terminal = {
      write: vi.fn((data: string, callback?: () => void) => {
        writes.push(data)
        callback?.()
      }),
    } as never
    const revision = beginTerminalGeometryCommit(terminal)

    const scheduler = createTerminalOutputScheduler({
      terminal,
      scrollbackBuffer: { append: vi.fn() },
      markScrollbackDirty: vi.fn(),
    })

    scheduler.handleChunk('AFTER_RESIZE')

    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual([])
    expect(scheduler.hasPendingWrites()).toBe(true)

    markTerminalGeometryAccepted(terminal, revision)

    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['AFTER_RESIZE'])
    expect(scheduler.hasPendingWrites()).toBe(false)

    scheduler.dispose()
    frameHarness.restore()
  })

  it('lets input-mode control sequences pass pending geometry only when they are next in order', () => {
    const frameHarness = installAnimationFrameHarness()
    const writes: string[] = []
    const terminal = {
      write: vi.fn((data: string, callback?: () => void) => {
        writes.push(data)
        callback?.()
      }),
    } as never
    const revision = beginTerminalGeometryCommit(terminal)

    const scheduler = createTerminalOutputScheduler({
      terminal,
      scrollbackBuffer: { append: vi.fn() },
      markScrollbackDirty: vi.fn(),
    })

    scheduler.handleChunk('\u001b[?2004h', { allowDuringPendingGeometry: true })

    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['\u001b[?2004h'])

    scheduler.handleChunk('AFTER_RESIZE')
    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['\u001b[?2004h'])
    expect(scheduler.hasPendingWrites()).toBe(true)

    markTerminalGeometryAccepted(terminal, revision)

    expect(frameHarness.runNextFrame()).toBe(true)
    expect(writes).toEqual(['\u001b[?2004h', 'AFTER_RESIZE'])
    expect(scheduler.hasPendingWrites()).toBe(false)

    scheduler.dispose()
    frameHarness.restore()
  })

  it('restores the viewport after a destructive redraw shrinks scrollback during a write', () => {
    const frameHarness = installAnimationFrameHarness()
    const terminal = {
      buffer: {
        active: {
          baseY: 967,
          viewportY: 571,
        },
      },
      _core: {
        _bufferService: {
          isUserScrolling: true,
          buffer: {
            ydisp: 571,
          },
        },
        _viewport: {
          queueSync: vi.fn(),
          scrollToLine: vi.fn((line: number) => {
            terminal.buffer.active.viewportY = line
            terminal._core._bufferService.buffer.ydisp = line
          }),
        },
      },
      scrollToLine: vi.fn((line: number) => {
        terminal.buffer.active.viewportY = line
        terminal._core._bufferService.buffer.ydisp = line
      }),
      write: vi.fn((_data: string, callback?: () => void) => {
        terminal.buffer.active.baseY = 79
        terminal.buffer.active.viewportY = 0
        terminal._core._bufferService.buffer.ydisp = 0
        callback?.()
      }),
    }

    const scheduler = createTerminalOutputScheduler({
      terminal: terminal as never,
      scrollbackBuffer: { append: vi.fn() },
      markScrollbackDirty: vi.fn(),
    })

    scheduler.handleChunk('\u001b[2J\u001b[Hredraw')
    expect(frameHarness.runNextFrame()).toBe(true)

    expect(terminal.buffer.active.viewportY).toBe(79)
    expect(terminal._core._bufferService.buffer.ydisp).toBe(79)
    expect(terminal._core._bufferService.isUserScrolling).toBe(false)

    scheduler.dispose()
    frameHarness.restore()
  })
})
