import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commitInitialTerminalNodeGeometry } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import {
  createRuntimeInitialGeometryCommitter,
  shouldPreferMeasuredInitialGeometryCommit,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'
import {
  cleanupTerminalGeometrySyncTestWindow,
  createTerminalMock,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

describe('terminal geometry commit helpers', () => {
  beforeEach(() => {
    installTerminalGeometrySyncTestWindow()
  })

  afterEach(() => {
    cleanupTerminalGeometrySyncTestWindow()
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
      revision: 1,
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

  it('keeps restored agent runtime geometry canonical during restart recovery', () => {
    expect(
      shouldPreferMeasuredInitialGeometryCommit({
        kind: 'agent',
        isLiveSessionReattach: false,
        canonicalInitialGeometry: null,
        suppressPtyResize: false,
        agentResumeSessionIdVerified: true,
        agentLaunchMode: null,
      }),
    ).toBe(false)
    expect(
      shouldPreferMeasuredInitialGeometryCommit({
        kind: 'agent',
        isLiveSessionReattach: false,
        canonicalInitialGeometry: null,
        suppressPtyResize: false,
        agentResumeSessionIdVerified: false,
        agentLaunchMode: 'resume',
      }),
    ).toBe(false)
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

  it('keeps restored agent snapshot geometry instead of committing smaller mounted measurement', async () => {
    const terminal = createTerminalMock()
    const fitAddon = {
      proposeDimensions: vi.fn(() => ({ cols: 91, rows: 39 })),
    }
    const lastCommittedPtySizeRef: { current: { cols: number; rows: number } | null } = {
      current: null,
    }
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: { current: fitAddon as never },
      containerRef: { current: { clientWidth: 720, clientHeight: 620 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef,
      sessionId: 'session-restored-agent',
      canonicalInitialGeometry: null,
      allowMeasuredResizeCommit: true,
      preferMeasuredGeometryCommit: false,
    })

    const size = await commitInitialGeometry({
      sessionId: 'session-restored-agent',
      epoch: 1,
      appliedSeq: 3,
      presentationRevision: 4,
      cols: 92,
      rows: 40,
      bufferKind: 'normal',
      cursor: { x: 0, y: 0 },
      title: 'opencode',
      serializedScreen: 'opencode',
    } as never)

    expect(size).toStrictEqual({ cols: 92, rows: 40, changed: false })
    expect(lastCommittedPtySizeRef.current).toStrictEqual({ cols: 92, rows: 40 })
    expect(fitAddon.proposeDimensions).not.toHaveBeenCalled()
    expect(terminal.resize).toHaveBeenCalledWith(92, 40)
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
      revision: 1,
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
      revision: 1,
    })
  })
})
