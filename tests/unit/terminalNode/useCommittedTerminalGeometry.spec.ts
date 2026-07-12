import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  commitTerminalGeometryForCurrentSession,
  useCommittedTerminalGeometry,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useCommittedTerminalGeometry'
import {
  commitSettledTerminalNodeGeometry,
  fitTerminalNodeToMeasuredSize,
  refreshTerminalNodeSize,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize'
import { canWriteTerminalOutput } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator'

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize',
  () => ({
    commitSettledTerminalNodeGeometry: vi.fn(),
    fitTerminalNodeToMeasuredSize: vi.fn(),
    refreshTerminalNodeSize: vi.fn(),
  }),
)

const commitSettledMock = vi.mocked(commitSettledTerminalNodeGeometry)
const fitTerminalNodeToMeasuredSizeMock = vi.mocked(fitTerminalNodeToMeasuredSize)
const refreshTerminalNodeSizeMock = vi.mocked(refreshTerminalNodeSize)

type CommitParams = Parameters<typeof commitTerminalGeometryForCurrentSession>[0]

function createCommitParams(): CommitParams {
  return {
    terminalRef: { current: null },
    fitAddonRef: { current: null },
    containerRef: { current: null },
    isPointerResizingRef: { current: false },
    lastCommittedPtySizeRef: { current: { cols: 80, rows: 24 } },
    suppressPtyResizeRef: { current: false },
    latestSessionIdRef: { current: 'session-a' },
    sessionId: 'session-a',
    scheduleWebglCanvasTransformCleanup: vi.fn(),
  }
}

function createTerminalMock(): never {
  return { cols: 80, rows: 24 } as never
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveDeferred: (() => void) | null = null
  const promise = new Promise<void>(resolve => {
    resolveDeferred = resolve
  })
  return {
    promise,
    resolve: () => {
      resolveDeferred?.()
    },
  }
}

describe('commitTerminalGeometryForCurrentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies the settled geometry only while the committed session is still current', async () => {
    const params = createCommitParams()
    commitSettledMock.mockImplementationOnce(async options => {
      options.lastCommittedPtySizeRef.current = { cols: 100, rows: 32 }
      return { cols: 100, rows: 32, changed: true }
    })

    await commitTerminalGeometryForCurrentSession(params, 'appearance_commit')

    expect(params.lastCommittedPtySizeRef.current).toStrictEqual({ cols: 100, rows: 32 })
    expect(params.scheduleWebglCanvasTransformCleanup).toHaveBeenCalledTimes(1)
  })

  it('keeps the current session geometry when an async commit finishes after session switch', async () => {
    const params = createCommitParams()
    const resizeBlocked = createDeferred()
    commitSettledMock.mockImplementationOnce(async options => {
      expect(options.lastCommittedPtySizeRef).not.toBe(params.lastCommittedPtySizeRef)
      await resizeBlocked.promise
      options.lastCommittedPtySizeRef.current = { cols: 100, rows: 32 }
      return { cols: 100, rows: 32, changed: true }
    })

    const committed = commitTerminalGeometryForCurrentSession(params, 'frame_commit')
    params.latestSessionIdRef.current = 'session-b'
    resizeBlocked.resolve()
    await committed

    expect(params.lastCommittedPtySizeRef.current).toStrictEqual({ cols: 80, rows: 24 })
    expect(params.scheduleWebglCanvasTransformCleanup).not.toHaveBeenCalled()
  })

  it('keeps the newer geometry when an older async commit settles last', async () => {
    const params = createCommitParams()
    params.terminalRef.current = createTerminalMock()
    const firstBlocked = createDeferred()
    const secondBlocked = createDeferred()

    commitSettledMock
      .mockImplementationOnce(async options => {
        await firstBlocked.promise
        options.lastCommittedPtySizeRef.current = { cols: 100, rows: 32 }
        return { cols: 100, rows: 32, changed: true }
      })
      .mockImplementationOnce(async options => {
        await secondBlocked.promise
        options.lastCommittedPtySizeRef.current = { cols: 120, rows: 40 }
        return { cols: 120, rows: 40, changed: true }
      })

    const firstCommit = commitTerminalGeometryForCurrentSession(params, 'frame_commit')
    const secondCommit = commitTerminalGeometryForCurrentSession(params, 'frame_commit')

    secondBlocked.resolve()
    await secondCommit
    firstBlocked.resolve()
    await firstCommit

    expect(params.lastCommittedPtySizeRef.current).toStrictEqual({ cols: 120, rows: 40 })
    expect(params.scheduleWebglCanvasTransformCleanup).toHaveBeenCalledTimes(1)
    expect(commitSettledMock.mock.calls[0]?.[0].geometryRevision).toBe(1)
    expect(commitSettledMock.mock.calls[1]?.[0].geometryRevision).toBe(2)
  })

  it('serializes geometry intents so a newer measurement starts after the prior ACK settles', async () => {
    const params = createCommitParams()
    params.terminalRef.current = createTerminalMock()
    const firstBlocked = createDeferred()
    commitSettledMock
      .mockImplementationOnce(async options => {
        await firstBlocked.promise
        options.lastCommittedPtySizeRef.current = { cols: 100, rows: 32 }
        return { cols: 100, rows: 32, changed: true }
      })
      .mockImplementationOnce(async options => {
        options.lastCommittedPtySizeRef.current = { cols: 120, rows: 40 }
        return { cols: 120, rows: 40, changed: true }
      })
    const { result } = renderHook(() => useCommittedTerminalGeometry(params))

    act(() => {
      result.current('frame_commit')
      result.current('appearance_commit')
    })

    await waitFor(() => {
      expect(commitSettledMock).toHaveBeenCalledTimes(1)
    })
    firstBlocked.resolve()
    await waitFor(() => {
      expect(commitSettledMock).toHaveBeenCalledTimes(2)
    })
    expect(commitSettledMock.mock.calls[1]?.[0].geometryRevision).toBe(2)
  })

  it('starts a new session queue without waiting for the prior session ACK', async () => {
    const params = createCommitParams()
    params.terminalRef.current = createTerminalMock()
    const oldSessionBlocked = createDeferred()
    commitSettledMock
      .mockImplementationOnce(async () => {
        await oldSessionBlocked.promise
        return { cols: 100, rows: 32, changed: true }
      })
      .mockResolvedValueOnce({ cols: 120, rows: 40, changed: true })
    const { result, rerender } = renderHook(() => useCommittedTerminalGeometry(params))
    act(() => result.current('frame_commit'))
    await waitFor(() => expect(commitSettledMock).toHaveBeenCalledTimes(1))

    params.sessionId = 'session-b'
    params.latestSessionIdRef.current = 'session-b'
    params.terminalRef.current = createTerminalMock()
    rerender()
    act(() => result.current('frame_commit'))

    await waitFor(() => expect(commitSettledMock).toHaveBeenCalledTimes(2))
    oldSessionBlocked.resolve()
  })

  it('refreshes current canonical geometry without a local fit when PTY resize is suppressed', async () => {
    const params = createCommitParams()
    params.suppressPtyResizeRef.current = true

    await commitTerminalGeometryForCurrentSession(params, 'appearance_commit')

    expect(refreshTerminalNodeSizeMock).toHaveBeenCalledWith({
      terminalRef: params.terminalRef,
      containerRef: params.containerRef,
      isPointerResizingRef: params.isPointerResizingRef,
    })
    expect(params.scheduleWebglCanvasTransformCleanup).toHaveBeenCalledTimes(1)
    expect(fitTerminalNodeToMeasuredSizeMock).not.toHaveBeenCalled()
    expect(commitSettledMock).not.toHaveBeenCalled()
    expect(params.lastCommittedPtySizeRef.current).toStrictEqual({ cols: 80, rows: 24 })
  })

  it('releases the output gate when a geometry commit rejects', async () => {
    const params = createCommitParams()
    const terminal = createTerminalMock()
    params.terminalRef.current = terminal
    commitSettledMock.mockRejectedValueOnce(new Error('resize rejected'))

    await expect(
      commitTerminalGeometryForCurrentSession(params, 'frame_commit'),
    ).resolves.toBeUndefined()

    expect(canWriteTerminalOutput(terminal)).toBe(true)
    expect(params.lastCommittedPtySizeRef.current).toStrictEqual({ cols: 80, rows: 24 })
    expect(params.scheduleWebglCanvasTransformCleanup).not.toHaveBeenCalled()
  })
})
