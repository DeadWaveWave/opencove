import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage, translate } from '../../../src/app/renderer/i18n'
import { EndpointOverviewProvider } from '../../../src/app/renderer/shell/components/EndpointOverviewProvider'
import { RemoteDirectoryPickerWindow } from '../../../src/app/renderer/shell/components/RemoteDirectoryPickerWindow'
import { RemoteEndpointStatusPanel } from '../../../src/app/renderer/shell/components/RemoteEndpointStatusPanel'
import { createOverview } from '../contexts/endpointsSection.testUtils'
import type { WorkerEndpointOverviewDto } from '../../../src/shared/contracts/dto'

function activeOverview(): WorkerEndpointOverviewDto {
  return {
    ...createOverview({ status: 'connecting' }),
    endpoint: { ...createOverview({}).endpoint, endpointId: 'managed-1', kind: 'remote_worker' },
    canBrowse: false,
    recommendedAction: 'show_details',
    isManaged: true,
    operation: {
      operationId: 'operation-1',
      revision: 5,
      kind: 'prepare',
      phase: 'installing_runtime',
      startedAt: '',
      updatedAt: '',
    },
  }
}

describe('Remote endpoint operation UI', () => {
  afterEach(async () => {
    await applyUiLanguage('en')
    delete (window as { opencoveApi?: unknown }).opencoveApi
    vi.restoreAllMocks()
  })

  it.each([
    ['en', 'Installing remote components…'],
    ['zh-CN', '正在安装远程组件…'],
  ] as const)(
    'names indeterminate progress and disables reconnect in %s',
    async (language, label) => {
      await applyUiLanguage(language)
      render(
        <RemoteEndpointStatusPanel
          t={translate}
          overview={activeOverview()}
          isBusy={false}
          onReconnect={() => undefined}
        />,
      )
      expect(screen.getByRole('progressbar', { name: label })).not.toHaveAttribute('aria-valuenow')
      expect(screen.getByRole('status')).toHaveTextContent(label)
      expect(screen.getByRole('button')).toBeDisabled()
    },
  )

  it('fences stale home lookups and waits for a fresh overview after reopening', async () => {
    const connected = {
      ...activeOverview(),
      operation: null,
      status: 'connected' as const,
      canBrowse: true,
    }
    let current = connected as WorkerEndpointOverviewDto
    let releaseHome!: (value: unknown) => void
    const home = new Promise(resolve => {
      releaseHome = resolve
    })
    const invoke = vi.fn(async ({ id }: { id: string }) => {
      if (id === 'endpoint.overview.list') {
        return { endpoints: [current] }
      }
      if (id === 'endpoint.homeDirectory') {
        return await home
      }
      if (id === 'endpoint.readDirectory') {
        return { entries: [] }
      }
      throw new Error(`Unexpected command: ${id}`)
    })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { controlSurface: { invoke } },
    })
    const ui = (open: boolean) => (
      <RemoteDirectoryPickerWindow
        isOpen={open}
        endpointId="managed-1"
        endpointLabel="Test"
        initialPath={null}
        onCancel={() => undefined}
        onSelect={() => undefined}
      />
    )
    const { rerender } = render(ui(true), { wrapper: EndpointOverviewProvider })
    await waitFor(() =>
      expect(invoke.mock.calls.some(([request]) => request.id === 'endpoint.homeDirectory')).toBe(
        true,
      ),
    )
    rerender(ui(false))
    current = activeOverview()
    rerender(ui(true))
    await screen.findByRole('progressbar')
    await act(async () => {
      releaseHome({ homeDirectory: '/stale-home' })
      await home
    })
    expect(
      invoke.mock.calls.filter(([request]) => request.id === 'endpoint.homeDirectory'),
    ).toHaveLength(1)
    expect(
      invoke.mock.calls.filter(([request]) => request.id === 'endpoint.readDirectory'),
    ).toHaveLength(0)
  })

  it('reopens the same Worker operation and loads home once when observation becomes browsable', async () => {
    let overview = activeOverview()
    const invoke = vi.fn(async ({ id }: { id: string }) => {
      if (id === 'endpoint.overview.list') {
        return { endpoints: [overview] }
      }
      if (id === 'endpoint.homeDirectory') {
        return { homeDirectory: '/home/test' }
      }
      if (id === 'endpoint.readDirectory') {
        return { entries: [] }
      }
      throw new Error(`Unexpected command: ${id}`)
    })
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: { controlSurface: { invoke } },
    })
    const cancel = vi.fn()
    const ui = (open: boolean) => (
      <RemoteDirectoryPickerWindow
        isOpen={open}
        endpointId="managed-1"
        endpointLabel="Test"
        initialPath={null}
        onCancel={cancel}
        onSelect={() => undefined}
      />
    )
    const { rerender } = render(ui(true), { wrapper: EndpointOverviewProvider })
    expect(await screen.findByRole('progressbar')).toHaveAccessibleName(
      'Installing remote components…',
    )
    fireEvent.click(screen.getByTestId('remote-directory-picker-cancel'))
    expect(cancel).toHaveBeenCalledOnce()
    rerender(ui(false))
    rerender(ui(true))
    expect(await screen.findByRole('progressbar')).toBeVisible()
    overview = {
      ...overview,
      status: 'connected',
      canBrowse: true,
      operation: null,
      recommendedAction: 'browse',
    }
    act(() => window.dispatchEvent(new Event('opencove:endpoint-overviews-changed')))
    await waitFor(() =>
      expect(screen.getByTestId('remote-directory-picker-path')).toHaveValue('/home/test'),
    )
    act(() => window.dispatchEvent(new Event('opencove:endpoint-overviews-changed')))
    await waitFor(() => expect(screen.getByTestId('remote-directory-picker-select')).toBeEnabled())
    expect(
      invoke.mock.calls.filter(([request]) => request.id === 'endpoint.homeDirectory'),
    ).toHaveLength(1)
    expect(
      invoke.mock.calls.filter(([request]) => request.id === 'endpoint.readDirectory'),
    ).toHaveLength(1)
    expect(invoke.mock.calls.some(([request]) => request.id === 'endpoint.prepare')).toBe(false)
  })
})
