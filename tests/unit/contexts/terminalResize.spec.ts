import { describe, expect, it } from 'vitest'
import { resolveStablePtySize } from '../../../src/contexts/workspace/presentation/renderer/utils/terminalResize'

describe('resolveStablePtySize', () => {
  it('returns measured size on first sync', () => {
    const next = resolveStablePtySize({
      previous: null,
      measured: { cols: 120, rows: 40 },
      preventRowShrink: true,
    })

    expect(next).toEqual({ cols: 120, rows: 40 })
  })

  it('keeps previous rows when row shrink is prevented and skips redundant resize', () => {
    const next = resolveStablePtySize({
      previous: { cols: 120, rows: 40 },
      measured: { cols: 120, rows: 28 },
      preventRowShrink: true,
    })

    expect(next).toBeNull()
  })

  it('keeps previous rows but still resizes when columns change', () => {
    const next = resolveStablePtySize({
      previous: { cols: 120, rows: 40 },
      measured: { cols: 132, rows: 28 },
      preventRowShrink: true,
    })

    expect(next).toEqual({ cols: 132, rows: 40 })
  })

  it('applies row shrink when prevention is disabled', () => {
    const next = resolveStablePtySize({
      previous: { cols: 120, rows: 40 },
      measured: { cols: 120, rows: 28 },
      preventRowShrink: false,
    })

    expect(next).toEqual({ cols: 120, rows: 28 })
  })

  it('returns null when computed pty size is unchanged', () => {
    const next = resolveStablePtySize({
      previous: { cols: 120, rows: 40 },
      measured: { cols: 120, rows: 35 },
      preventRowShrink: true,
    })

    expect(next).toBeNull()
  })
})
