import { commitInitialTerminalNodeGeometry } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import { createRuntimeInitialGeometryCommitter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'
import {
  canWriteTerminalOutput,
  hasTerminalGeometryCommitFailed,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'
import {
  cleanupTerminalGeometrySyncTestWindow,
  createTerminalMock,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

function fixture() {
  const terminal = createTerminalMock()
  const lastCommittedPtySizeRef = {
    current: { cols: 80, rows: 24 } as { cols: number; rows: number } | null,
  }
  const options = {
    terminalRef: { current: terminal as never },
    fitAddonRef: { current: { proposeDimensions: () => ({ cols: 65, rows: 44 }) } as never },
    containerRef: { current: { clientWidth: 640, clientHeight: 660 } as never },
    isPointerResizingRef: { current: false },
    lastCommittedPtySizeRef,
    sessionId: 'session-failure',
    reason: 'frame_commit' as const,
  }
  return { terminal, options }
}

describe('unconfirmed terminal geometry', () => {
  beforeEach(installTerminalGeometrySyncTestWindow)
  afterEach(cleanupTerminalGeometrySyncTestWindow)

  it('asks the canonical owner even when a reattached renderer cache matches the frame', async () => {
    const { options } = fixture()
    options.lastCommittedPtySizeRef.current = { cols: 65, rows: 44 }
    ptyResize.mockRejectedValueOnce(new Error('runtime still unconfirmed'))
    await expect(commitInitialTerminalNodeGeometry(options)).rejects.toThrow(/unconfirmed/)
    expect(ptyResize).toHaveBeenCalledOnce()
  })

  it.each(['accepted_unverified', 'runtime_failed'])(
    'does not apply or cache the old geometry for %s',
    async status => {
      const { terminal, options } = fixture()
      ptyResize.mockImplementationOnce(async payload => ({
        sessionId: payload.sessionId,
        operationId: payload.operationId,
        status,
        changed: false,
        geometry: { cols: 80, rows: 24, revision: 9 },
        authority: { role: 'controller', epoch: 1 },
      }))
      await expect(commitInitialTerminalNodeGeometry(options)).rejects.toThrow(/not confirmed/)
      expect(options.lastCommittedPtySizeRef.current).toBeNull()
      expect(terminal.resize).not.toHaveBeenCalled()
      await expect(commitInitialTerminalNodeGeometry(options)).resolves.toMatchObject({
        cols: 65,
        rows: 44,
      })
      expect(ptyResize).toHaveBeenCalledTimes(2)
    },
  )

  it('does not restore the old cached size after an initial native mutation fails to confirm', async () => {
    const { terminal, options } = fixture()
    ptyResize.mockRejectedValueOnce(new Error('observer unavailable'))
    const commit = createRuntimeInitialGeometryCommitter({
      ...options,
      canonicalInitialGeometry: { cols: 80, rows: 24 },
      preferMeasuredGeometryCommit: true,
    })
    await expect(commit(null)).resolves.toBeNull()
    expect(options.lastCommittedPtySizeRef.current).toBeNull()
    expect(terminal.resize).not.toHaveBeenCalled()
    expect(canWriteTerminalOutput(terminal as never)).toBe(true)
    expect(hasTerminalGeometryCommitFailed(terminal as never)).toBe(true)
  })

  it('does not restore the old canonical size when an initial acknowledgement outlives its terminal', async () => {
    const { terminal, options } = fixture()
    const replacement = createTerminalMock()
    ptyResize.mockImplementationOnce(async payload => {
      options.terminalRef.current = replacement as never
      options.lastCommittedPtySizeRef.current = { cols: 100, rows: 30 }
      return {
        sessionId: payload.sessionId,
        operationId: payload.operationId,
        status: 'accepted',
        changed: true,
        geometry: { cols: 65, rows: 44, revision: 9 },
        authority: { role: 'controller', epoch: 1 },
      }
    })
    const commit = createRuntimeInitialGeometryCommitter({
      ...options,
      canonicalInitialGeometry: { cols: 80, rows: 24 },
      preferMeasuredGeometryCommit: true,
    })
    await expect(commit(null)).resolves.toBeNull()
    expect(options.lastCommittedPtySizeRef.current).toEqual({ cols: 100, rows: 30 })
    expect(replacement.resize).not.toHaveBeenCalled()
    expect(canWriteTerminalOutput(terminal as never)).toBe(true)
  })
})
