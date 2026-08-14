import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalCommandInputState } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/commandInput'
import { createRuntimeTerminalInputBridge } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/createRuntimeTerminalInputBridge'

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('runtime terminal input bridge', () => {
  it('preserves command semantics for input accepted during hydration', async () => {
    const pendingWrite = createDeferred()
    const write = vi.fn(() => pendingWrite.promise)
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: { pty: { write } },
    })

    let forwardData = (_data: string) => undefined
    const terminal = {
      attachCustomKeyEventHandler: vi.fn(),
      getSelection: () => '',
      hasSelection: () => false,
      onBinary: vi.fn(() => ({ dispose: vi.fn() })),
      onData: vi.fn((listener: (data: string) => void) => {
        forwardData = listener
        return { dispose: vi.fn() }
      }),
    } as unknown as Terminal
    const onCommandRun = vi.fn()
    const bridge = createRuntimeTerminalInputBridge({
      terminal,
      sessionId: 'pty-session-hydrating',
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: onCommandRun },
      onAgentOverlayExitRef: { current: undefined },
      commandInputStateRef: { current: createTerminalCommandInputState() },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: false,
      pendingUserInputBufferRef: { current: [] },
      recentUserInteractionAtRef: { current: Date.now() },
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })

    forwardData('codex')
    forwardData('\r')

    expect(onCommandRun).not.toHaveBeenCalled()
    pendingWrite.resolve()
    await bridge.ptyWriteQueue.whenIdle()
    expect(write).toHaveBeenCalled()
    expect(onCommandRun).toHaveBeenCalledTimes(1)
    expect(onCommandRun).toHaveBeenCalledWith('codex', expect.any(Number))

    bridge.dispose()
  })

  it('does not let a delayed interrupt clear a replacement overlay activation', async () => {
    const pendingWrite = createDeferred()
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: {
          write: vi.fn(() => pendingWrite.promise),
        },
      },
    })

    let forwardData = (_data: string) => undefined
    const terminal = {
      attachCustomKeyEventHandler: vi.fn(),
      getSelection: () => '',
      hasSelection: () => false,
      onBinary: vi.fn(() => ({ dispose: vi.fn() })),
      onData: vi.fn((listener: (data: string) => void) => {
        forwardData = listener
        return { dispose: vi.fn() }
      }),
    } as unknown as Terminal

    const replacementExit = vi.fn()
    const initialExit = vi.fn(() => {
      onAgentOverlayExitRef.current = undefined
    })
    const onAgentOverlayExitRef: { current: (() => void) | undefined } = {
      current: initialExit,
    }
    const bridge = createRuntimeTerminalInputBridge({
      terminal,
      sessionId: 'pty-session-1',
      openTerminalFind: vi.fn(),
      onCommandRunRef: { current: undefined },
      onAgentOverlayExitRef,
      commandInputStateRef: { current: createTerminalCommandInputState() },
      suppressPtyResizeRef: { current: false },
      syncTerminalSize: vi.fn(),
      shouldGateInitialUserInput: false,
      pendingUserInputBufferRef: { current: [] },
      recentUserInteractionAtRef: { current: Date.now() },
      inputDiagnosticsEnabled: false,
      terminalDiagnostics: { log: vi.fn() },
    })
    bridge.enableTerminalDataForwarding()
    bridge.handlePtyOutputChunk('\u001b[?1049hagent running')

    forwardData('\u0003')
    bridge.handlePtyOutputChunk('\u001b[?1049lterminal prompt')
    expect(initialExit).toHaveBeenCalledTimes(1)
    onAgentOverlayExitRef.current = replacementExit
    pendingWrite.resolve()

    await bridge.ptyWriteQueue.whenIdle()
    expect(replacementExit).not.toHaveBeenCalled()

    bridge.dispose()
  })
})
