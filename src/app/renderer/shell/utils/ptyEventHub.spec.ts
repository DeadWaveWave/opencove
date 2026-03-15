import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '@shared/contracts/dto'
import { createPtyEventHub } from './ptyEventHub'

describe('createPtyEventHub', () => {
  it('shares one low-level data subscription and routes by session id', () => {
    let dataListener: ((event: TerminalDataEvent) => void) | undefined
    const unsubscribeDataSource = vi.fn()

    const source = {
      onData: vi.fn((listener: (event: TerminalDataEvent) => void) => {
        dataListener = listener
        return unsubscribeDataSource
      }),
      onExit: vi.fn((_listener: (event: TerminalExitEvent) => void) => () => undefined),
      onState: vi.fn((_listener: (event: TerminalSessionStateEvent) => void) => () => undefined),
      onMetadata: vi.fn(
        (_listener: (event: TerminalSessionMetadataEvent) => void) => () => undefined,
      ),
    }

    const hub = createPtyEventHub(source)
    const sessionOneListener = vi.fn()
    const sessionTwoListener = vi.fn()
    const globalListener = vi.fn()

    const unsubscribeSessionOne = hub.onSessionData('session-1', sessionOneListener)
    const unsubscribeSessionTwo = hub.onSessionData('session-2', sessionTwoListener)
    const unsubscribeGlobal = hub.onData(globalListener)

    expect(source.onData).toHaveBeenCalledTimes(1)

    if (typeof dataListener !== 'function') {
      throw new Error('Expected data listener to be registered')
    }
    dataListener({ sessionId: 'session-1', data: 'hello' })

    expect(sessionOneListener).toHaveBeenCalledWith({ sessionId: 'session-1', data: 'hello' })
    expect(sessionTwoListener).not.toHaveBeenCalled()
    expect(globalListener).toHaveBeenCalledWith({ sessionId: 'session-1', data: 'hello' })

    unsubscribeGlobal()
    unsubscribeSessionOne()

    expect(unsubscribeDataSource).not.toHaveBeenCalled()

    unsubscribeSessionTwo()

    expect(unsubscribeDataSource).toHaveBeenCalledTimes(1)

    hub.dispose()
  })

  it('tears down every low-level subscription on dispose', () => {
    const unsubscribeDataSource = vi.fn()
    const unsubscribeExitSource = vi.fn()
    const unsubscribeStateSource = vi.fn()
    const unsubscribeMetadataSource = vi.fn()

    const source = {
      onData: vi.fn((_listener: (event: TerminalDataEvent) => void) => unsubscribeDataSource),
      onExit: vi.fn((_listener: (event: TerminalExitEvent) => void) => unsubscribeExitSource),
      onState: vi.fn(
        (_listener: (event: TerminalSessionStateEvent) => void) => unsubscribeStateSource,
      ),
      onMetadata: vi.fn(
        (_listener: (event: TerminalSessionMetadataEvent) => void) => unsubscribeMetadataSource,
      ),
    }

    const hub = createPtyEventHub(source)
    hub.onData(() => undefined)
    hub.onExit(() => undefined)
    hub.onState(() => undefined)
    hub.onMetadata(() => undefined)

    hub.dispose()

    expect(unsubscribeDataSource).toHaveBeenCalledTimes(1)
    expect(unsubscribeExitSource).toHaveBeenCalledTimes(1)
    expect(unsubscribeStateSource).toHaveBeenCalledTimes(1)
    expect(unsubscribeMetadataSource).toHaveBeenCalledTimes(1)
  })
})
