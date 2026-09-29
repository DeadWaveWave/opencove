import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitBoardNode } from '../../../src/contexts/workspace/presentation/renderer/components/GitBoardNode'
import type { PluginNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ transform: [0, 0, 1] }),
}))

const data: PluginNodeData = {
  pluginId: 'git-board',
  schemaVersion: 1,
  repoPath: '/repo',
  mountId: null,
  graphLimit: 30,
}
const base = {
  id: 'git-one',
  title: 'Git Board',
  data,
  position: { x: 0, y: 0 },
  width: 600,
  height: 500,
  onClose: () => undefined,
  onResize: () => undefined,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

afterEach(() => vi.unstubAllGlobals())

describe('GitBoardNode snapshot lifetime', () => {
  it('does not refetch when canvas projection replaces node data during drag or resize', async () => {
    const invoke = vi.fn(async () => ({ clean: true, commits: [], branch: 'main' }))
    vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
    const { rerender } = render(<GitBoardNode {...base} />)
    await screen.findByText('Clean')
    expect(invoke).toHaveBeenCalledTimes(2)

    rerender(
      <GitBoardNode
        {...base}
        data={{ ...data }}
        position={{ x: 150, y: 200 }}
        width={660}
        height={540}
      />,
    )
    expect(invoke).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Git Board' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4))
  })

  it('discards an older repository response after rebinding the window', async () => {
    const oldStatus = deferred<Record<string, unknown>>()
    const oldGraph = deferred<Record<string, unknown>>()
    const invoke = vi
      .fn()
      .mockReturnValueOnce(oldStatus.promise)
      .mockReturnValueOnce(oldGraph.promise)
      .mockResolvedValueOnce({ changedFileCount: 0 })
      .mockResolvedValueOnce({ clean: true, commits: [], branch: 'new-branch' })
    vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
    const { rerender } = render(<GitBoardNode {...base} />)
    rerender(<GitBoardNode {...base} data={{ ...data, repoPath: '/new-repo' }} />)
    await screen.findByText('new-branch')
    await act(async () => {
      oldStatus.resolve({ changedFileCount: 8 })
      oldGraph.resolve({ clean: false, commits: [], branch: 'stale-branch' })
    })
    expect(screen.queryByText('stale-branch')).not.toBeInTheDocument()
    expect(screen.getByText('Clean')).toBeInTheDocument()
  })

  it('retains the host window controls when querying Git fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('Worker disconnected'))
    vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
    const onClose = vi.fn()
    render(<GitBoardNode {...base} onClose={onClose} />)
    await screen.findByText('Git data unavailable: Worker disconnected')
    expect(screen.getByTestId('git-board-resizer-left')).toBeInTheDocument()
    expect(screen.getByTestId('git-board-resizer-top')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('git-board-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
