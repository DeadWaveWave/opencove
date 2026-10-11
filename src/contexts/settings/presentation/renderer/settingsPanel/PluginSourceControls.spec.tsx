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
  it('shows retained candidate recovery and disables stale apply without deleting the working copy', async () => {
    invoke.mockResolvedValue({
      distribution: { repository: 'https://github.com/example/tool', ref: 'main' },
      dirty: false,
      history: [],
      candidates: [
        {
          id: 'pending',
          directory: '/worker/candidates/pending',
          status: 'conflict',
          error: 'Conflict in README',
        },
        { id: 'old', directory: '/worker/candidates/old', status: 'failed', stale: 'installation' },
      ],
    })
    const clipboard = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('opencoveApi', {
      controlSurface: { invoke },
      clipboard: { writeText: clipboard },
    })
    render(<PluginSourceControls plugin={examplePlugin} />)
    const apply = await screen.findByTestId('settings-plugin-candidate-apply-pending')
    expect(apply).toBeEnabled()
    expect(screen.getByTestId('settings-plugin-candidate-apply-old')).toBeDisabled()
    fireEvent.click(screen.getAllByText('Inspect working copy')[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy directory', hidden: true })[0])
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith('/worker/candidates/pending'))
    fireEvent.click(apply)
    await waitFor(() =>
      expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.git.apply', {
        candidateId: 'pending',
      }),
    )
  })
  it('clears an earlier check when ref changes and submits only the explicitly checked ref', async () => {
    render(<PluginSourceControls plugin={examplePlugin} />)
    const field = await screen.findByTestId('settings-plugin-update-ref')
    fireEvent.change(field, { target: { value: 'stable' } })
    invoke.mockResolvedValueOnce({
      updateAvailable: false,
      currentCommit: 'same',
      availableCommit: 'same',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await screen.findByRole('button', { name: 'Apply update' })
    expect(invoke).toHaveBeenCalledWith({
      kind: 'command',
      id: 'plugin.git.check',
      payload: { pluginId: examplePlugin.id, ref: 'stable' },
    })
    fireEvent.change(field, { target: { value: 'other' } })
    expect(screen.queryByRole('button', { name: 'Apply update' })).toBeNull()
  })
  it('keeps Chinese candidate recovery labels readable', async () => {
    await applyUiLanguage('zh-CN')
    invoke.mockResolvedValue({
      distribution: null,
      dirty: false,
      history: [],
      candidates: [{ id: 'old', directory: '/worker/old', status: 'failed', stale: 'source' }],
    })
    render(<PluginSourceControls plugin={examplePlugin} />)
    expect(await screen.findByText('候选版本已过期')).toBeVisible()
    expect(screen.getByRole('button', { name: '应用已解决的版本' })).toBeDisabled()
  })
})
