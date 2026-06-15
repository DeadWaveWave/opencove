import { describe, expect, it } from 'vitest'
import {
  resolveDefaultAgentWindowSize,
  resolveDefaultImageWindowSize,
  resolveDefaultNoteWindowSize,
  resolveDefaultTerminalWindowSize,
  resolveDefaultTaskWindowSize,
  resolveDefaultWebsiteWindowSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/constants'
import { resolveDefaultAgentLaunchGeometry } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/agentLaunchGeometry'
import { resolveNodePlacementAnchorFromViewportCenter } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
import { resolveTerminalDisplayMetrics } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTerminalDisplayMetrics'

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

    expect(resolveDefaultWebsiteWindowSize('large')).toEqual({
      width: 1140,
      height: 788,
    })

    expect(resolveDefaultNoteWindowSize('large')).toEqual({
      width: 276,
      height: 188,
    })

    expect(resolveDefaultImageWindowSize('large')).toEqual({
      width: 564,
      height: 388,
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

    expect(resolveDefaultWebsiteWindowSize('compact')).toEqual({
      width: 948,
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

    expect(resolveDefaultWebsiteWindowSize()).toEqual({
      width: 1044,
      height: 724,
    })

    expect(resolveDefaultImageWindowSize()).toEqual({
      width: 516,
      height: 356,
    })
  })

  it('uses canonical agent sizing for OpenCode windows', () => {
    expect(resolveDefaultAgentWindowSize('regular', 'opencode')).toEqual({
      width: 516,
      height: 724,
    })
  })

  it('resolves default agent launch frame and PTY geometry from one owner', () => {
    expect(
      resolveDefaultAgentLaunchGeometry({
        bucket: 'regular',
        provider: 'opencode',
        terminalFontSize: 13,
      }),
    ).toEqual({
      frameSize: {
        width: 516,
        height: 724,
      },
      terminalGeometry: {
        cols: 62,
        rows: 45,
      },
    })
  })

  it('reserves the visible xterm vertical scrollbar gutter when estimating PTY columns', () => {
    const launch = resolveDefaultAgentLaunchGeometry({
      bucket: 'regular',
      provider: 'codex',
      terminalFontSize: 13,
      terminalDisplayMetrics: {
        fontSize: 13,
        lineHeight: 1,
        letterSpacing: 0,
        cssCellWidth: 7.15,
        cssCellHeight: 15.2,
      },
    })

    expect(launch.terminalGeometry.cols).toBe(68)
  })

  it('uses display calibration metrics when estimating launch PTY geometry', () => {
    const base = resolveDefaultAgentLaunchGeometry({
      bucket: 'regular',
      provider: 'codex',
      terminalFontSize: 13,
    })
    const compensated = resolveDefaultAgentLaunchGeometry({
      bucket: 'regular',
      provider: 'codex',
      terminalFontSize: 13,
      terminalDisplayMetrics: {
        fontSize: 15,
        lineHeight: 1.1,
        letterSpacing: 0.2,
      },
    })

    expect(compensated.frameSize).toEqual(base.frameSize)
    expect(compensated.terminalGeometry.cols).toBeLessThan(base.terminalGeometry.cols)
    expect(compensated.terminalGeometry.rows).toBeLessThan(base.terminalGeometry.rows)
  })

  it('prefers measured display cell dimensions when estimating launch PTY geometry', () => {
    const base = resolveDefaultAgentLaunchGeometry({
      bucket: 'regular',
      provider: 'codex',
      terminalFontSize: 13,
    })
    const measured = resolveDefaultAgentLaunchGeometry({
      bucket: 'regular',
      provider: 'codex',
      terminalFontSize: 13,
      terminalDisplayMetrics: {
        fontSize: 13,
        lineHeight: 1,
        letterSpacing: 0,
        cssCellWidth: 8,
        cssCellHeight: 16,
      },
    })

    expect(measured.frameSize).toEqual(base.frameSize)
    expect(measured.terminalGeometry).toEqual({
      cols: 61,
      rows: 42,
    })
  })

  it('uses client-measured calibration cell dimensions for local launch geometry', () => {
    const metrics = resolveTerminalDisplayMetrics({
      terminalFontSize: 13,
      terminalDisplayCalibration: {
        version: 1,
        profileKey: '{"fontSize":13,"fontFamily":null}',
        fontSize: 18,
        lineHeight: 1,
        letterSpacing: 0,
        target: {
          cols: 84,
          rows: 24,
          cssCellWidth: 6,
          cssCellHeight: 14,
          effectiveDpr: 1,
        },
        measured: {
          cols: 48,
          rows: 23,
          cssCellWidth: 10.5,
          cssCellHeight: 20,
          effectiveDpr: 1,
        },
        score: 0,
        measuredAt: '2026-05-10T00:00:00.000Z',
      } as never,
    })

    const launch = resolveDefaultAgentLaunchGeometry({
      bucket: 'regular',
      provider: 'codex',
      terminalFontSize: 13,
      terminalDisplayMetrics: metrics,
    })

    expect(metrics.cssCellWidth).toBe(10.5)
    expect(metrics.cssCellHeight).toBe(20)
    expect(launch.terminalGeometry).toEqual({
      cols: 46,
      rows: 33,
    })
  })

  it('does not use shared target cell dimensions for local launch geometry', () => {
    const metrics = resolveTerminalDisplayMetrics({
      terminalFontSize: 13,
      terminalDisplayCalibration: {
        version: 1,
        profileKey: '{"fontSize":13,"fontFamily":null}',
        fontSize: 18,
        lineHeight: 1,
        letterSpacing: 0,
        target: {
          cols: 84,
          rows: 24,
          cssCellWidth: 6,
          cssCellHeight: 14,
          effectiveDpr: 1,
        },
        score: 0,
        measuredAt: '2026-05-10T00:00:00.000Z',
      },
    })

    const launch = resolveDefaultAgentLaunchGeometry({
      bucket: 'regular',
      provider: 'codex',
      terminalFontSize: 13,
      terminalDisplayMetrics: metrics,
    })

    expect(metrics.cssCellWidth).toBeNull()
    expect(metrics.cssCellHeight).toBeNull()
    expect(launch.terminalGeometry).toEqual({
      cols: 45,
      rows: 32,
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
