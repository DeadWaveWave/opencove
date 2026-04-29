import { describe, expect, it } from 'vitest'
import { resolveInitialTerminalDimensions } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/initialDimensions'

describe('resolveInitialTerminalDimensions', () => {
  it('returns null when cached dimensions are missing or invalid', () => {
    expect(resolveInitialTerminalDimensions(null)).toBeNull()
    expect(resolveInitialTerminalDimensions({})).toBeNull()
    expect(resolveInitialTerminalDimensions({ cols: undefined, rows: 24 })).toBeNull()
    expect(resolveInitialTerminalDimensions({ cols: 80, rows: undefined })).toBeNull()
    expect(resolveInitialTerminalDimensions({ cols: 0, rows: 24 })).toBeNull()
    expect(resolveInitialTerminalDimensions({ cols: 80, rows: 0 })).toBeNull()
    expect(resolveInitialTerminalDimensions({ cols: Number.NaN, rows: 24 })).toBeNull()
  })

  it('normalizes positive cached dimensions before passing them to xterm', () => {
    expect(resolveInitialTerminalDimensions({ cols: 80.9, rows: 24.1 })).toEqual({
      cols: 80,
      rows: 24,
    })
  })

  it('uses the first valid source as the initial dimensions', () => {
    expect(
      resolveInitialTerminalDimensions(
        { cols: null, rows: 24 },
        { cols: 64, rows: 44 },
        { cols: 80, rows: 24 },
      ),
    ).toEqual({
      cols: 64,
      rows: 44,
    })
  })
})
