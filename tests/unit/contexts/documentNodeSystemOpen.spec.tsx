import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppError } from '../../../src/shared/errors/appError'
import type { SystemFileReference } from '../../../src/contexts/workspace/presentation/renderer/utils/systemFileOpening'
import { DocumentNodeSystemOpen } from '../../../src/contexts/workspace/presentation/renderer/components/DocumentNodeSystemOpen'

const { canOpen, open } = vi.hoisted(() => ({
  canOpen: vi.fn<(reference: SystemFileReference) => Promise<boolean>>(),
  open: vi.fn<(reference: SystemFileReference, isCurrent?: () => boolean) => Promise<boolean>>(),
}))

vi.mock('../../../src/contexts/workspace/presentation/renderer/utils/systemFileOpening', () => ({
  canOpenSystemFile: canOpen,
  openSystemFile: open,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const reference = { uri: 'file:///repo/unsupported.bin', mountId: 'mount' }
const button = () => screen.queryByRole('button', { name: 'Open with default app' })

beforeEach(() => {
  canOpen.mockReset().mockResolvedValue(true)
  open.mockReset().mockResolvedValue(true)
})

describe('DocumentNode system opening', () => {
  it('offers the explicit action only after its source has been confirmed local', async () => {
    const capability = deferred<boolean>()
    canOpen.mockReturnValue(capability.promise)
    render(<DocumentNodeSystemOpen {...reference} />)
    expect(button()).toBeNull()
    await act(async () => capability.resolve(true))
    fireEvent.click(button()!)
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    expect(open.mock.calls[0][0]).toEqual(reference)
    expect(open.mock.calls[0][1]?.()).toBe(true)
    await waitFor(() => expect(button()).toBeEnabled())
  })

  it('keeps unavailable sources hidden', async () => {
    canOpen.mockResolvedValue(false)
    render(<DocumentNodeSystemOpen {...reference} />)
    await waitFor(() => expect(canOpen).toHaveBeenCalledWith(reference))
    expect(button()).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('ignores late capability results after the source mount changes', async () => {
    const previous = deferred<boolean>()
    canOpen.mockReturnValueOnce(previous.promise).mockResolvedValueOnce(false)
    const view = render(<DocumentNodeSystemOpen {...reference} />)
    view.rerender(<DocumentNodeSystemOpen {...reference} mountId="remote-mount" />)
    await waitFor(() => expect(canOpen).toHaveBeenCalledTimes(2))
    await act(async () => previous.resolve(true))
    expect(button()).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })

  it('invalidates the old opening request and ignores its failure after the URI changes', async () => {
    const previous = deferred<boolean>()
    open.mockReturnValueOnce(previous.promise)
    const view = render(<DocumentNodeSystemOpen {...reference} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open with default app' }))
    const isPreviousCurrent = open.mock.calls[0][1]!
    view.rerender(<DocumentNodeSystemOpen {...reference} uri="file:///repo/other.bin" />)
    expect(isPreviousCurrent()).toBe(false)
    await act(async () => previous.reject(new Error('Stale failure')))
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(button()).toBeEnabled())
  })

  it('invalidates a pending request when the document unmounts', async () => {
    const pending = deferred<boolean>()
    open.mockReturnValue(pending.promise)
    const view = render(<DocumentNodeSystemOpen {...reference} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open with default app' }))
    const isCurrent = open.mock.calls[0][1]!
    view.unmount()
    expect(isCurrent()).toBe(false)
    await act(async () => pending.resolve(false))
  })

  it.each([
    [createAppError('common.approved_path_required'), 'outside the allowed filesystem scope'],
    [new Error('Native opening failed'), 'Could not open this target'],
  ])('shows an inline action failure and permits an explicit retry', async (failure, message) => {
    open.mockRejectedValueOnce(failure)
    render(<DocumentNodeSystemOpen {...reference} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open with default app' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(String(message))
    expect(button()).toBeEnabled()
    fireEvent.click(button()!)
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
