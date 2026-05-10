import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeTerminalInputBridge } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/createRuntimeTerminalInputBridge'

function createTerminalHarness() {
  let onDataHandler: ((data: string) => void) | null = null
  let onBinaryHandler: ((data: string) => void) | null = null

  const terminal = {
    attachCustomKeyEventHandler: vi.fn(),
    onData: vi.fn((listener: (data: string) => void) => {
      onDataHandler = listener
      return { dispose: vi.fn() }
    }),
    onBinary: vi.fn((listener: (data: string) => void) => {
      onBinaryHandler = listener
      return { dispose: vi.fn() }
    }),
  }

  return {
    terminal,
    emitData: (data: string) => onDataHandler?.(data),
    emitBinary: (data: string) => onBinaryHandler?.(data),
  }
}

describe('createRuntimeTerminalInputBridge', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      opencoveApi: {
        pty: {
          write: vi.fn(async () => undefined),
        },
      },
    })
  })

  it('does not buffer synthetic focus events while restored agent input is gated', () => {
    const { terminal, emitData } = createTerminalHarness()
    const pendingUserInputBufferRef = {
      current: [] as Array<{ data: string; encoding: 'utf8' | 'binary' }>,
    }

    createRuntimeTerminalInputBridge({
      terminal: terminal as never,
      sessionId: 'session-1',
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: undefined },
      commandInputStateRef: { current: { pending: '' } as never },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: true,
      pendingUserInputBufferRef,
      recentUserInteractionAtRef: { current: performance.now() },
      suppressPassiveSyntheticInteraction: false,
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })

    emitData('\u001b[I')

    expect(pendingUserInputBufferRef.current).toStrictEqual([])
  })

  it('continues buffering typed text while restored agent input is gated', () => {
    const { terminal, emitData } = createTerminalHarness()
    const pendingUserInputBufferRef = {
      current: [] as Array<{ data: string; encoding: 'utf8' | 'binary' }>,
    }

    createRuntimeTerminalInputBridge({
      terminal: terminal as never,
      sessionId: 'session-1',
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: undefined },
      commandInputStateRef: { current: { pending: '' } as never },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: true,
      pendingUserInputBufferRef,
      recentUserInteractionAtRef: { current: performance.now() },
      suppressPassiveSyntheticInteraction: false,
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })

    emitData('a')

    expect(pendingUserInputBufferRef.current).toStrictEqual([{ data: 'a', encoding: 'utf8' }])
  })


  it('drops passive synthetic mouse reports for OpenCode even after the input gate opens', async () => {
    const { terminal, emitBinary } = createTerminalHarness()
    const pendingUserInputBufferRef = {
      current: [] as Array<{ data: string; encoding: 'utf8' | 'binary' }>,
    }

    const ptyWrite = vi.fn(async () => undefined)
    ;(window as typeof window & { opencoveApi: Window['opencoveApi'] }).opencoveApi = {
      ...(window.opencoveApi as Window['opencoveApi']),
      pty: {
        write: ptyWrite,
      },
    }

    createRuntimeTerminalInputBridge({
      terminal: terminal as never,
      sessionId: 'session-1',
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: undefined },
      commandInputStateRef: { current: { pending: '' } as never },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: false,
      pendingUserInputBufferRef,
      recentUserInteractionAtRef: { current: 0 },
      suppressPassiveSyntheticInteraction: true,
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })

    emitBinary('[M' + String.fromCharCode(96, 81, 81))
    await Promise.resolve()
    await Promise.resolve()

    expect(pendingUserInputBufferRef.current).toStrictEqual([])
    expect(ptyWrite).not.toHaveBeenCalled()
  })

  it('still forwards synthetic mouse reports when there was a recent real user interaction', async () => {
    const { terminal, emitBinary } = createTerminalHarness()
    const pendingUserInputBufferRef = {
      current: [] as Array<{ data: string; encoding: 'utf8' | 'binary' }>,
    }

    const ptyWrite = vi.fn(async () => undefined)
    ;(window as typeof window & { opencoveApi: Window['opencoveApi'] }).opencoveApi = {
      ...(window.opencoveApi as Window['opencoveApi']),
      pty: {
        write: ptyWrite,
      },
    }

    const bridge = createRuntimeTerminalInputBridge({
      terminal: terminal as never,
      sessionId: 'session-1',
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: undefined },
      commandInputStateRef: { current: { pending: '' } as never },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: false,
      pendingUserInputBufferRef,
      recentUserInteractionAtRef: { current: performance.now() },
      suppressPassiveSyntheticInteraction: true,
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })

    bridge.enableTerminalDataForwarding()
    emitBinary('[M' + String.fromCharCode(96, 81, 81))
    await Promise.resolve()
    await Promise.resolve()

    expect(ptyWrite).toHaveBeenCalledTimes(1)
    expect(ptyWrite).toHaveBeenCalledWith({
      sessionId: 'session-1',
      data: '[M' + String.fromCharCode(96, 81, 81),
      encoding: 'binary',
    })
  })

  it('does not buffer synthetic mouse reports while restored agent input is gated', () => {
    const { terminal, emitBinary } = createTerminalHarness()
    const pendingUserInputBufferRef = {
      current: [] as Array<{ data: string; encoding: 'utf8' | 'binary' }>,
    }

    createRuntimeTerminalInputBridge({
      terminal: terminal as never,
      sessionId: 'session-1',
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: undefined },
      commandInputStateRef: { current: { pending: '' } as never },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: true,
      pendingUserInputBufferRef,
      recentUserInteractionAtRef: { current: performance.now() },
      suppressPassiveSyntheticInteraction: false,
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })

    emitBinary('\u001b[<0;34;22M')

    expect(pendingUserInputBufferRef.current).toStrictEqual([])
  })

  it('does not flush buffered synthetic interaction input when the restored gate opens', async () => {
    const { terminal, emitBinary, emitData } = createTerminalHarness()
    const pendingUserInputBufferRef = {
      current: [] as Array<{ data: string; encoding: 'utf8' | 'binary' }>,
    }

    const ptyWrite = vi.fn(async () => undefined)
    ;(window as typeof window & { opencoveApi: Window['opencoveApi'] }).opencoveApi = {
      ...(window.opencoveApi as Window['opencoveApi']),
      pty: {
        write: ptyWrite,
      },
    }

    const bridge = createRuntimeTerminalInputBridge({
      terminal: terminal as never,
      sessionId: 'session-1',
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: undefined },
      commandInputStateRef: { current: { pending: '' } as never },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: true,
      pendingUserInputBufferRef,
      recentUserInteractionAtRef: { current: performance.now() },
      suppressPassiveSyntheticInteraction: false,
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })

    emitBinary('\u001b[<0;34;22M')
    emitData('x')

    expect(pendingUserInputBufferRef.current).toStrictEqual([{ data: 'x', encoding: 'utf8' }])

    bridge.releaseBufferedUserInput()
    await Promise.resolve()
    await Promise.resolve()

    expect(ptyWrite).toHaveBeenCalledTimes(1)
    expect(ptyWrite).toHaveBeenCalledWith({
      sessionId: 'session-1',
      data: 'x',
    })
  })
})
