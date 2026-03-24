import { describe, expect, it } from 'vitest'
import {
  resolveDefaultAgentWindowSize,
  resolveDefaultNoteWindowSize,
  resolveDefaultTerminalWindowSize,
  resolveDefaultTaskWindowSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { resolveNodePlacementAnchorFromViewportCenter } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'

describe('workspace canvas default sizing', () => {
  it('resolves canonical window sizes from the selected bucket', () => {
    expect(resolveDefaultTerminalWindowSize('large')).toEqual({
      width: 564,
      height: 388,
    })

    expect(resolveDefaultTaskWindowSize('large')).toEqual({
      width: 276,
      height: 388,
    })

    expect(resolveDefaultAgentWindowSize('large')).toEqual({
      width: 564,
      height: 788,
    })

    expect(resolveDefaultNoteWindowSize('large')).toEqual({
      width: 276,
      height: 188,
    })
  })

  it('keeps compact bucket sizes on the canonical grid', () => {
    expect(resolveDefaultTerminalWindowSize('compact')).toEqual({
      width: 468,
      height: 324,
    })

    expect(resolveDefaultAgentWindowSize('compact')).toEqual({
      width: 468,
      height: 660,
    })
  })

  it('defaults to the regular bucket when none is provided', () => {
    expect(resolveDefaultTerminalWindowSize()).toEqual({
      width: 516,
      height: 356,
    })

    expect(resolveDefaultAgentWindowSize()).toEqual({
      width: 516,
      height: 724,
    })
  })
})

describe('workspace canvas node placement anchor', () => {
  it('converts a viewport center point into the node top-left anchor', () => {
    expect(
      resolveNodePlacementAnchorFromViewportCenter({ x: 320, y: 220 }, { width: 420, height: 280 }),
    ).toEqual({
      x: 110,
      y: 80,
    })
  })
})
