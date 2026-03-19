import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_WINDOW_MAX_SIZE,
  resolveDefaultAgentWindowSize,
  resolveDefaultTerminalWindowSize,
  resolveDefaultTaskWindowSize,
  DEFAULT_TERMINAL_WINDOW_BASE_SIZE,
  DEFAULT_TERMINAL_WINDOW_MAX_SIZE,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { resolveNodePlacementAnchorFromViewportCenter } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'

describe('workspace canvas default terminal sizing', () => {
  it('applies scale percent to default terminal/agent window size', () => {
    const size = resolveDefaultTerminalWindowSize(80)

    expect(size).toEqual({
      width: Math.round((DEFAULT_TERMINAL_WINDOW_BASE_SIZE.width * 80) / 100),
      height: Math.round((DEFAULT_TERMINAL_WINDOW_BASE_SIZE.height * 80) / 100),
    })
  })

  it('clamps invalid scale values to allowed range', () => {
    const tooSmall = resolveDefaultTerminalWindowSize(-1)
    const tooLarge = resolveDefaultTerminalWindowSize(999)

    expect(tooSmall).toEqual({
      width: 468,
      height: 360,
    })
    expect(tooLarge).toEqual(DEFAULT_TERMINAL_WINDOW_MAX_SIZE)
  })
})

describe('workspace canvas default task sizing', () => {
  it('resolves task window size from viewport ratio', () => {
    const size = resolveDefaultTaskWindowSize({ width: 1920, height: 1080 })

    expect(size).toEqual({
      width: 576,
      height: 864,
    })
  })

  it('clamps task window defaults to the maximum pixel limit', () => {
    const size = resolveDefaultTaskWindowSize({ width: 6000, height: 3000 })

    expect(size).toEqual(DEFAULT_TASK_WINDOW_MAX_SIZE)
  })
})

describe('workspace canvas default agent sizing', () => {
  it('matches task default height while keeping terminal default width', () => {
    const size = resolveDefaultAgentWindowSize(80, { width: 1920, height: 1080 })

    expect(size).toEqual({
      width: Math.round((DEFAULT_TERMINAL_WINDOW_BASE_SIZE.width * 80) / 100),
      height: resolveDefaultTaskWindowSize({ width: 1920, height: 1080 }).height,
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
