import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import * as registry from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { examplePlugin } from '@contexts/plugins/presentation/renderer/pluginPresentationTestFixture'
import { PluginSourceControls } from './PluginSourceControls'

let invoke = vi.fn()
beforeEach(async () => {
  await applyUiLanguage('en')
  invoke = vi.fn().mockResolvedValue({
    distribution: { repository: 'https://github.com/example/tool', ref: 'main' },
    dirty: true,
    history: [{ revision: 'previous-revision', version: '0.9.0' }],
  })
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
  vi.spyOn(registry, 'changeInstalledPlugin').mockResolvedValue({ status: 'updated' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('plugin source actions', () => {
  it('checks without updating and keeps conflicting candidates from looking successful', async () => {
    render(<PluginSourceControls plugin={examplePlugin} />)
    await screen.findByRole('button', { name: 'Check for updates' })
    expect(registry.changeInstalledPlugin).not.toHaveBeenCalled()
    invoke.mockResolvedValueOnce({
      updateAvailable: true,
      currentCommit: 'one',
      availableCommit: 'two',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await screen.findByRole('button', { name: 'Apply update' })
    expect(registry.changeInstalledPlugin).not.toHaveBeenCalled()
    vi.mocked(registry.changeInstalledPlugin).mockResolvedValueOnce({
      status: 'conflict',
      error: 'Resolve the source conflict',
      candidateDirectory: '/candidates/merge',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply update' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Resolve the source conflict')
    expect(screen.getByRole('alert')).toHaveTextContent('/candidates/merge')
    expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.git.update', {
      pluginId: examplePlugin.id,
    })
  })
  it('refreshes same-revision source metadata and clears a prior update check when runtime changes', async () => {
    const current = { ...examplePlugin, revision: 'same-code', runtimeGeneration: 1 }
    const { rerender } = render(<PluginSourceControls plugin={current} />)
    await screen.findByRole('button', { name: 'Check for updates' })
    invoke.mockResolvedValueOnce({
      updateAvailable: true,
      currentCommit: 'one',
      availableCommit: 'two',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await screen.findByRole('button', { name: 'Apply update' })
    invoke.mockResolvedValueOnce({
      distribution: { repository: 'https://github.com/example/moved', ref: 'stable' },
      dirty: false,
      history: [],
    })
    rerender(<PluginSourceControls plugin={{ ...current, runtimeGeneration: 2 }} />)
    await screen.findByText('https://github.com/example/moved')
    expect(screen.queryByRole('button', { name: 'Apply update' })).toBeNull()
    expect(screen.queryByText('Previous versions')).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(3)
  })
  it('offers the first retained local revision and restores only the explicitly selected code', async () => {
    invoke.mockResolvedValueOnce({
      distribution: null,
      dirty: false,
      history: [{ revision: 'previous-revision', version: '0.9.0' }],
    })
    render(<PluginSourceControls plugin={{ ...examplePlugin, revision: 'current' }} />)
    fireEvent.click(await screen.findByText('Previous versions'))
    const select = screen.getByRole('button', { name: 'Saved version' })
    expect(screen.getByRole('button', { name: 'Restore version', hidden: true })).toBeDisabled()
    fireEvent.click(select)
    fireEvent.click(screen.getByRole('option', { name: /0.9.0/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore version', hidden: true }))
    await waitFor(() =>
      expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.rollback', {
        pluginId: examplePlugin.id,
        revision: 'previous-revision',
      }),
    )
  })
})
