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
    expect(resolveDefaultTerminalWindowSize(100, { width: 1920, height: 1080 })).toEqual({
      width: 640,
      height: 420,
    })

    expect(resolveDefaultTaskWindowSize({ width: 1920, height: 1080 })).toEqual({
      width: 320,
      height: 420,
    })

    expect(resolveDefaultAgentWindowSize(100, { width: 1920, height: 1080 })).toEqual({
      width: 640,
      height: 840,
    })

    expect(resolveDefaultNoteWindowSize({ width: 1920, height: 1080 })).toEqual({
      width: 320,
      height: 210,
    })
  })

  it('applies scale percent to default terminal/agent window size', () => {
    expect(resolveDefaultTerminalWindowSize(80, { width: 1920, height: 1080 })).toEqual({
      width: 512,
      height: 336,
    })

    expect(resolveDefaultAgentWindowSize(80, { width: 1920, height: 1080 })).toEqual({
      width: 512,
      height: 672,
    })
  })

  it('clamps invalid scale values to allowed range', () => {
    expect(resolveDefaultTerminalWindowSize(-1, { width: 1920, height: 1080 })).toEqual({
      width: 400,
      height: 260,
    })

    expect(resolveDefaultTerminalWindowSize(999, { width: 1920, height: 1080 })).toEqual({
      width: 720,
      height: 504,
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
