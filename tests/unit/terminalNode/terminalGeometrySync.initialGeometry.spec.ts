import { describe, expect, it, vi } from 'vitest'
import {
  commitInitialTerminalNodeGeometry,
  commitSettledTerminalNodeGeometry,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  createRuntimeInitialGeometryCommitter,
  shouldPreferMeasuredInitialGeometryCommit,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'
import {
  createTerminalMock,
  installTerminalGeometrySyncWindowMock,
} from './terminalGeometrySync.testUtils'
describe('terminal initial geometry sync', () => {
  const { ptyResize } = installTerminalGeometrySyncWindowMock()
  it('waits for stable measured geometry before the initial restore commit', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }

    const size = await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi
            .fn()
            .mockReturnValueOnce({ cols: 80, rows: 24 })
            .mockReturnValueOnce({ cols: 132, rows: 41 })
            .mockReturnValueOnce({ cols: 132, rows: 41 }),
        } as never,
      },
      containerRef: { current: { clientWidth: 910, clientHeight: 620 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-geometry',
      reason: 'frame_commit',
    })

    expect(size).toStrictEqual({ cols: 132, rows: 41, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 132, rows: 41 })
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-initial-geometry',
      cols: 132,
      rows: 41,
      reason: 'frame_commit',
    })
  })

  it('releases the previous xterm height clamp before stable initial measurement', async () => {
    const terminal = createTerminalMock()
    terminal.element.style.height = '321px'
    const measuredHeights: Array<string | undefined> = []
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }

    await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => {
            measuredHeights.push(terminal.element.style.height)
            return { cols: 80, rows: 24 }
          }),
        } as never,
      },
      containerRef: { current: { clientWidth: 640, clientHeight: 360 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-release-height',
      reason: 'frame_commit',
    })

    expect(measuredHeights[0]).toBe('')
  })

  it('keeps settling when the initial mounted measurement expands after early stable frames', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }

    const size = await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi
            .fn()
            .mockReturnValueOnce({ cols: 97, rows: 40 })
            .mockReturnValueOnce({ cols: 97, rows: 40 })
            .mockReturnValueOnce({ cols: 104, rows: 41 })
            .mockReturnValue({ cols: 104, rows: 41 }),
        } as never,
      },
      containerRef: { current: { clientWidth: 864, clientHeight: 624 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-post-mount-expand',
      reason: 'frame_commit',
    })

    expect(size).toStrictEqual({ cols: 104, rows: 41, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 104, rows: 41 })
    expect(terminal.resize).toHaveBeenLastCalledWith(104, 41)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-initial-post-mount-expand',
      cols: 104,
      rows: 41,
      reason: 'frame_commit',
    })
  })

  it('keeps settling when applying the early geometry unlocks the final mounted measurement', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }

    const size = await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() =>
            terminal.cols < 97 ? { cols: 97, rows: 40 } : { cols: 104, rows: 41 },
          ),
        } as never,
      },
      containerRef: { current: { clientWidth: 864, clientHeight: 624 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-local-settle-expand',
      reason: 'frame_commit',
    })

    expect(size).toStrictEqual({ cols: 104, rows: 41, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 104, rows: 41 })
    expect(terminal.resize).toHaveBeenCalledWith(97, 40)
    expect(terminal.resize).toHaveBeenLastCalledWith(104, 41)
    expect(ptyResize).toHaveBeenCalledTimes(1)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-initial-local-settle-expand',
      cols: 104,
      rows: 41,
      reason: 'frame_commit',
    })
  })

  it('uses the settled measured geometry for appearance commits after display metrics change', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: { cols: 97, rows: 40 },
    }

    const size = await commitSettledTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi
            .fn()
            .mockReturnValueOnce({ cols: 97, rows: 40 })
            .mockReturnValueOnce({ cols: 97, rows: 40 })
            .mockReturnValueOnce({ cols: 104, rows: 41 })
            .mockReturnValue({ cols: 104, rows: 41 }),
        } as never,
      },
      containerRef: { current: { clientWidth: 864, clientHeight: 624 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-appearance-post-metrics-expand',
      reason: 'appearance_commit',
    })

    expect(size).toStrictEqual({ cols: 104, rows: 41, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 104, rows: 41 })
    expect(terminal.resize).toHaveBeenLastCalledWith(104, 41)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-appearance-post-metrics-expand',
      cols: 104,
      rows: 41,
      reason: 'appearance_commit',
    })
  })

  it('does not write PTY geometry when the initial restore size is already canonical', async () => {
    const terminal = createTerminalMock()
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: { cols: 64, rows: 44 },
    }

    const size = await commitInitialTerminalNodeGeometry({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: {
          proposeDimensions: vi.fn(() => ({ cols: 64, rows: 44 })),
        } as never,
      },
      containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-initial-geometry',
      reason: 'frame_commit',
    })

    expect(size).toStrictEqual({ cols: 64, rows: 44, changed: false })
    expect(terminal.resize).toHaveBeenCalledWith(64, 44)
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('uses durable runtime geometry locally without writing PTY geometry during restore', async () => {
    const terminal = createTerminalMock()
    const fitAddon = {
      proposeDimensions: vi.fn(() => ({ cols: 65, rows: 44 })),
    }
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: { current: fitAddon as never },
      containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-runtime-restore',
      canonicalInitialGeometry: { cols: 64, rows: 44 },
      allowMeasuredResizeCommit: true,
    })

    const size = await commitInitialGeometry(null)

    expect(size).toStrictEqual({ cols: 64, rows: 44, changed: false })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 64, rows: 44 })
    expect(fitAddon.proposeDimensions).not.toHaveBeenCalled()
    expect(terminal.resize).toHaveBeenCalledWith(64, 44)
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('commits measured runtime geometry only when no canonical restore geometry exists', async () => {
    const terminal = createTerminalMock()
    const fitAddon = {
      proposeDimensions: vi.fn(() => ({ cols: 65, rows: 44 })),
    }
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: { current: fitAddon as never },
      containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-runtime-restore',
      canonicalInitialGeometry: null,
      allowMeasuredResizeCommit: true,
    })

    const size = await commitInitialGeometry(null)

    expect(size).toStrictEqual({ cols: 65, rows: 44, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 65, rows: 44 })
    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(terminal.resize).toHaveBeenCalledWith(65, 44)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-runtime-restore',
      cols: 65,
      rows: 44,
      reason: 'frame_commit',
    })
  })

  it('prefers measured initial geometry for transient plain terminal restore geometry', () => {
    expect(
      shouldPreferMeasuredInitialGeometryCommit({
        kind: 'terminal',
        isLiveSessionReattach: false,
        canonicalInitialGeometry: null,
        suppressPtyResize: false,
      }),
    ).toBe(true)
  })

  it('keeps durable plain terminal geometry canonical during restore', () => {
    expect(
      shouldPreferMeasuredInitialGeometryCommit({
        kind: 'terminal',
        isLiveSessionReattach: false,
        canonicalInitialGeometry: { cols: 80, rows: 24 },
        suppressPtyResize: false,
      }),
    ).toBe(false)
  })

  it('prefers measured initial geometry for agent live reattach', () => {
    expect(
      shouldPreferMeasuredInitialGeometryCommit({
        kind: 'agent',
        isLiveSessionReattach: true,
        canonicalInitialGeometry: null,
        suppressPtyResize: false,
      }),
    ).toBe(true)
  })

  it('does not prefer measured initial geometry during terminal live reattach or suppressed resize', () => {
    expect(
      shouldPreferMeasuredInitialGeometryCommit({
        kind: 'terminal',
        isLiveSessionReattach: true,
        canonicalInitialGeometry: null,
        suppressPtyResize: false,
      }),
    ).toBe(false)
    expect(
      shouldPreferMeasuredInitialGeometryCommit({
        kind: 'terminal',
        isLiveSessionReattach: false,
        canonicalInitialGeometry: null,
        suppressPtyResize: true,
      }),
    ).toBe(false)
  })

  it('uses worker snapshot geometry locally without writing PTY geometry during restore', async () => {
    const terminal = createTerminalMock()
    const fitAddon = {
      proposeDimensions: vi.fn(() => ({ cols: 65, rows: 44 })),
    }
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: { current: fitAddon as never },
      containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-runtime-restore',
      canonicalInitialGeometry: null,
      allowMeasuredResizeCommit: true,
    })

    const size = await commitInitialGeometry({
      sessionId: 'session-runtime-restore',
      epoch: 1,
      appliedSeq: 3,
      presentationRevision: 4,
      cols: 72,
      rows: 20,
      bufferKind: 'normal',
      cursor: { x: 0, y: 0 },
      title: '',
      serializedScreen: '',
    } as never)

    expect(size).toStrictEqual({ cols: 72, rows: 20, changed: false })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 72, rows: 20 })
    expect(fitAddon.proposeDimensions).not.toHaveBeenCalled()
    expect(terminal.resize).toHaveBeenCalledWith(72, 20)
    expect(ptyResize).not.toHaveBeenCalled()
  })

  it('can reconcile an estimated launch geometry with the mounted xterm measurement', async () => {
    const terminal = createTerminalMock()
    const fitAddon = {
      proposeDimensions: vi.fn(() => ({ cols: 69, rows: 44 })),
    }
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: { current: fitAddon as never },
      containerRef: { current: { clientWidth: 516, clientHeight: 690 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-opencode-launch',
      canonicalInitialGeometry: { cols: 64, rows: 45 },
      allowMeasuredResizeCommit: true,
      preferMeasuredGeometryCommit: true,
    })

    const size = await commitInitialGeometry({
      sessionId: 'session-opencode-launch',
      epoch: 1,
      appliedSeq: 3,
      presentationRevision: 4,
      cols: 64,
      rows: 45,
      bufferKind: 'alternate',
      cursor: { x: 0, y: 0 },
      title: 'opencode',
      serializedScreen: 'opencode',
    } as never)

    expect(size).toStrictEqual({ cols: 69, rows: 44, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 69, rows: 44 })
    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(terminal.resize).toHaveBeenCalledWith(69, 44)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-opencode-launch',
      cols: 69,
      rows: 44,
      reason: 'frame_commit',
    })
  })

  it('can reconcile a codex agent launch geometry with the mounted xterm measurement', async () => {
    const terminal = createTerminalMock()
    const fitAddon = {
      proposeDimensions: vi.fn(() => ({ cols: 68, rows: 40 })),
    }
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: { current: fitAddon as never },
      containerRef: { current: { clientWidth: 520, clientHeight: 320 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-codex-launch',
      canonicalInitialGeometry: { cols: 64, rows: 24 },
      allowMeasuredResizeCommit: true,
      preferMeasuredGeometryCommit: true,
    })

    const size = await commitInitialGeometry({
      sessionId: 'session-codex-launch',
      epoch: 1,
      appliedSeq: 3,
      presentationRevision: 4,
      cols: 64,
      rows: 24,
      bufferKind: 'normal',
      cursor: { x: 0, y: 0 },
      title: 'codex',
      serializedScreen: 'codex',
    } as never)

    expect(size).toStrictEqual({ cols: 68, rows: 40, changed: true })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 68, rows: 40 })
    expect(fitAddon.proposeDimensions).toHaveBeenCalled()
    expect(terminal.resize).toHaveBeenCalledWith(68, 40)
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-codex-launch',
      cols: 68,
      rows: 40,
      reason: 'frame_commit',
    })
  })
})
