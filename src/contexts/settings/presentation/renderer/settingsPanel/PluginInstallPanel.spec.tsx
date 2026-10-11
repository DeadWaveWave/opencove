import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import * as registry from '@contexts/plugins/presentation/renderer/usePluginRegistry'
import { PluginInstallPanel } from './PluginInstallPanel'

beforeEach(async () => {
  await applyUiLanguage('en')
  vi.spyOn(registry, 'changeInstalledPlugin').mockResolvedValue({ status: 'installed' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('explicit plugin installation', () => {
  it('selects discovery results without installing and sends only the chosen repository on submit', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      repositories: [
        {
          name: 'Example Tool',
          url: 'https://github.com/example/tool',
          description: 'A tool',
          stars: 1,
        },
      ],
    })
    invoke.mockResolvedValue({
      repository: 'https://github.com/example/tool',
      name: 'example/tool',
      ref: 'main',
      commit: 'a'.repeat(40),
      description: 'A tool',
      stars: 1,
      readme: '# Reviewed documentation',
      readmePath: 'README.md',
      manifest: null,
      manifestError: null,
    })
    vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
    const installed = vi.fn()
    render(<PluginInstallPanel onCancel={vi.fn()} onInstalled={installed} />)
    fireEvent.click(screen.getByRole('button', { name: /^Discover$/ }))
    fireEvent.change(screen.getByTestId('settings-plugin-discover-query'), {
      target: { value: 'clock' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search GitHub' }))
    fireEvent.click(await screen.findByRole('button', { name: 'View details' }))
    await screen.findByText('Reviewed documentation')
    expect(registry.changeInstalledPlugin).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use this reviewed commit' }))
    expect(invoke).toHaveBeenCalledWith({
      kind: 'query',
      id: 'plugin.discover',
      payload: { query: 'clock' },
    })
    expect(registry.changeInstalledPlugin).not.toHaveBeenCalled()
    expect(screen.getByTestId('settings-plugin-install-source')).toHaveValue(
      'https://github.com/example/tool',
    )
    fireEvent.click(screen.getByTestId('settings-plugin-install-submit'))
    await waitFor(() => expect(installed).toHaveBeenCalledOnce())
    expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.git.install', {
      repository: 'https://github.com/example/tool',
      ref: 'a'.repeat(40),
      build: { kind: 'none' },
    })
  })
  it('keeps an unsuccessful candidate visible and never reports it as installed', async () => {
    vi.mocked(registry.changeInstalledPlugin).mockResolvedValue({
      status: 'failed',
      error: 'Manifest missing',
      candidateDirectory: '/candidates/example',
      candidateId: 'initial-failure',
    })
    const installed = vi.fn()
    render(<PluginInstallPanel onCancel={vi.fn()} onInstalled={installed} />)
    fireEvent.change(screen.getByTestId('settings-plugin-install-source'), {
      target: { value: 'https://github.com/example/tool' },
    })
    fireEvent.click(screen.getByTestId('settings-plugin-install-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Manifest missing')
    expect(screen.getByRole('alert')).toHaveTextContent('/candidates/example')
    expect(installed).not.toHaveBeenCalled()
    expect(screen.getByText(/No version was installed/)).toBeVisible()
    expect(screen.getByTestId('settings-plugin-candidate-apply-initial-failure')).toBeEnabled()
  })
  it('passes explicit locked build options without guessing a build system', async () => {
    render(<PluginInstallPanel onCancel={vi.fn()} onInstalled={vi.fn()} />)
    fireEvent.change(screen.getByTestId('settings-plugin-install-source'), {
      target: { value: '/source/repo' },
    })
    fireEvent.click(screen.getByText('Optional repository settings'))
    fireEvent.click(screen.getByRole('button', { name: 'Build strategy' }))
    fireEvent.click(screen.getByRole('option', { name: /^pnpm$/ }))
    fireEvent.change(screen.getByTestId('settings-plugin-build-script'), {
      target: { value: 'build:plugin' },
    })
    fireEvent.change(screen.getByTestId('settings-plugin-build-output'), {
      target: { value: 'dist' },
    })
    fireEvent.click(screen.getByTestId('settings-plugin-install-submit'))
    await waitFor(() =>
      expect(registry.changeInstalledPlugin).toHaveBeenCalledWith('plugin.git.install', {
        repository: '/source/repo',
        build: { kind: 'pnpm', script: 'build:plugin', outputDirectory: 'dist' },
      }),
    )
  })
})
