import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeInitialGeometryCommitter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'
import {
  cleanupTerminalGeometrySyncTestWindow,
  createTerminalMock,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

function snapshot(sessionId: string) {
  return {
    sessionId,
    epoch: 1,
    appliedSeq: 3,
    presentationRevision: 4,
    cols: 60,
    rows: 15,
    geometryRevision: 7,
    bufferKind: 'normal' as const,
    cursor: { x: 0, y: 0 },
    title: '',
    serializedScreen: '',
  }
}

describe('terminal live reattach geometry', () => {
  beforeEach(installTerminalGeometrySyncTestWindow)
  afterEach(cleanupTerminalGeometrySyncTestWindow)

  it('commits measured geometry from the snapshot revision and attached authority', async () => {
    const terminal = createTerminalMock()
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: {
        current: { proposeDimensions: vi.fn(() => ({ cols: 105, rows: 31 })) } as never,
      },
      containerRef: { current: { clientWidth: 820, clientHeight: 520 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: null },
      sessionId: 'session-live-controller',
      canonicalInitialGeometry: { cols: 60, rows: 15 },
      allowMeasuredResizeCommit: true,
      preferMeasuredGeometryCommit: true,
    })

    await expect(
      commitInitialGeometry(snapshot('session-live-controller'), {
        sessionId: 'session-live-controller',
        authority: { role: 'controller', epoch: 3 },
      }),
    ).resolves.toEqual({ cols: 105, rows: 31, changed: true })
    expect(ptyResize).toHaveBeenCalledWith({
      sessionId: 'session-live-controller',
      cols: 105,
      rows: 31,
      reason: 'frame_commit',
      operationId: expect.any(String),
      baseGeometryRevision: 7,
      authorityEpoch: 3,
    })
  })

  it('keeps canonical snapshot geometry for a viewer without writing PTY geometry', async () => {
    const terminal = createTerminalMock()
    const fitAddon = { proposeDimensions: vi.fn(() => ({ cols: 105, rows: 31 })) }
    const commitInitialGeometry = createRuntimeInitialGeometryCommitter({
      terminalRef: { current: terminal as never },
      fitAddonRef: { current: fitAddon as never },
      containerRef: { current: { clientWidth: 820, clientHeight: 520 } as never },
      isPointerResizingRef: { current: false },
      lastCommittedPtySizeRef: { current: null },
      sessionId: 'session-live-viewer',
      canonicalInitialGeometry: { cols: 60, rows: 15 },
      allowMeasuredResizeCommit: true,
      preferMeasuredGeometryCommit: true,
    })

    await expect(
      commitInitialGeometry(snapshot('session-live-viewer'), {
        sessionId: 'session-live-viewer',
        authority: { role: 'viewer', epoch: 3 },
      }),
    ).resolves.toEqual({ cols: 60, rows: 15, changed: false })
    expect(fitAddon.proposeDimensions).not.toHaveBeenCalled()
    expect(ptyResize).not.toHaveBeenCalled()
  })
})
