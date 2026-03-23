import { describe, expect, it } from 'vitest'
import {
  resolveDefaultAgentWindowSize,
  resolveDefaultNoteWindowSize,
  resolveDefaultTerminalWindowSize,
  resolveDefaultTaskWindowSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { resolveNodePlacementAnchorFromViewportCenter } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'

describe('workspace canvas default sizing', () => {
  it('resolves canonical window sizes from viewport bucket', () => {
    expect(resolveDefaultTerminalWindowSize({ width: 1920, height: 1080 })).toEqual({
      width: 564,
      height: 388,
    })

    expect(resolveDefaultTaskWindowSize({ width: 1920, height: 1080 })).toEqual({
      width: 276,
      height: 388,
    })

    expect(resolveDefaultAgentWindowSize({ width: 1920, height: 1080 })).toEqual({
      width: 564,
      height: 788,
    })

    expect(resolveDefaultNoteWindowSize({ width: 1920, height: 1080 })).toEqual({
      width: 276,
      height: 188,
    })
  })

  it('keeps new terminal and agent sizes on canonical grid for smaller viewports too', () => {
    expect(resolveDefaultTerminalWindowSize({ width: 1440, height: 900 })).toEqual({
      width: 468,
      height: 324,
    })

    expect(resolveDefaultAgentWindowSize({ width: 1440, height: 900 })).toEqual({
      width: 468,
      height: 660,
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
