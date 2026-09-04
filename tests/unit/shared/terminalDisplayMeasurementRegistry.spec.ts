import { describe, expect, it, vi } from 'vitest'
import {
  listTerminalDisplayMeasurementHandles,
  registerTerminalDisplayMeasurementHandle,
} from '@shared/runtime/terminalDisplayMeasurementRegistry'

describe('terminal display measurement registry', () => {
  it('does not let an old disposer remove a replacement registration', () => {
    const first = {
      terminal: { id: 'first' } as never,
      fitAddon: {} as never,
      getRendererKind: vi.fn(() => 'dom' as const),
    }
    const replacement = {
      terminal: { id: 'replacement' } as never,
      fitAddon: {} as never,
      getRendererKind: vi.fn(() => 'webgl' as const),
    }

    const disposeFirst = registerTerminalDisplayMeasurementHandle('node-1', first)
    const disposeReplacement = registerTerminalDisplayMeasurementHandle('node-1', replacement)
    disposeFirst()

    expect(listTerminalDisplayMeasurementHandles()).toEqual([replacement])

    disposeReplacement()
    expect(listTerminalDisplayMeasurementHandles()).toEqual([])
  })
})
