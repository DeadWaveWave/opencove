import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_SETTINGS,
} from '../../../src/contexts/settings/domain/agentSettings'
import type { AgentProviderAvailability } from '../../../src/shared/contracts/dto'
import { AgentSettingsPage } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/AgentSettingsPage'

type Props = React.ComponentProps<typeof AgentSettingsPage>

function createProps(): Props {
  return {
    settings: DEFAULT_AGENT_SETTINGS,
    modelCatalogByProvider: Object.fromEntries(
      AGENT_PROVIDERS.map(provider => [
        provider,
        {
          models: ['test-model'],
          source: null,
          fetchedAt: null,
          isLoading: false,
          error: null,
        },
      ]),
    ) as Props['modelCatalogByProvider'],
    addModelInputByProvider: Object.fromEntries(
      AGENT_PROVIDERS.map(provider => [provider, '']),
    ) as Props['addModelInputByProvider'],
    onChangeDefaultProvider: vi.fn(),
    onChangeAgentProviderOrder: vi.fn(),
    onChangeAgentFullAccess: vi.fn(),
    onToggleCustomModelEnabled: vi.fn(),
    onSelectProviderModel: vi.fn(),
    onRemoveCustomModelOption: vi.fn(),
    onChangeAddModelInput: vi.fn(),
    onAddCustomModelOption: vi.fn(),
    onChangeAgentEnvByProvider: vi.fn(),
  }
}

function availability(status: AgentProviderAvailability['status']): AgentProviderAvailability {
  return {
    provider: 'codex',
    command: 'codex',
    status,
    executablePath: status === 'available' ? '/custom/codex' : null,
    source: null,
    diagnostics: [],
  }
}

function installApi(listInstalledProviders: ReturnType<typeof vi.fn>, installProvider = vi.fn()) {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { agent: { listInstalledProviders, installProvider } },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi
})

describe('Agent list and provider detail', () => {
  it('exposes accessible drag handles and keeps the default first', () => {
    const props = createProps()
    render(<AgentSettingsPage {...props} />)
    expect(screen.getByTestId('settings-agent-drag-handle-codex')).toHaveAccessibleName(
      'Reorder Codex',
    )
    expect(screen.getByTestId('settings-agent-order-item-codex')).toHaveAttribute(
      'data-default',
      'true',
    )
    expect(screen.getAllByTestId(/^settings-agent-order-item-/)[0]).toHaveAttribute(
      'data-testid',
      'settings-agent-order-item-codex',
    )
    expect(
      screen.queryByTestId('settings-agent-order-move-down-claude-code'),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-default-provider-codex')).not.toBeInTheDocument()
    expect(props.onChangeAgentProviderOrder).not.toHaveBeenCalled()
    expect(props.onChangeDefaultProvider).not.toHaveBeenCalled()
  })

  it('replaces the list with one provider detail while keeping model and environment writes scoped', () => {
    const props = createProps()
    props.settings = { ...props.settings, defaultProvider: 'claude-code' }
    const { container } = render(<AgentSettingsPage {...props} />)
    fireEvent.click(screen.getByTestId('settings-agent-configure-codex'))
    expect(screen.queryByTestId('settings-agent-order-item-codex')).toBeNull()
    expect(screen.getByTestId('settings-agent-detail-codex').querySelector('h3')).toHaveTextContent(
      'Codex',
    )
    fireEvent.click(screen.getByTestId('settings-agent-make-default-codex'))
    expect(props.onChangeDefaultProvider).toHaveBeenCalledWith('codex')
    expect(
      container.querySelector('#settings-agent-env-codex')?.closest('details'),
    ).not.toHaveAttribute('open')
    // Collapsing an advanced group keeps its editable children mounted.
    expect(screen.getByTestId('settings-agent-env-add-codex')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-custom-model-enabled-codex'))
    expect(props.onToggleCustomModelEnabled).toHaveBeenCalledWith('codex', true)
    const environment = container.querySelector('#settings-agent-env-codex')!.closest('details')!
    fireEvent.click(environment.querySelector('summary')!)
    fireEvent.click(screen.getByTestId('settings-agent-env-add-codex'))
    expect(props.onChangeAgentEnvByProvider).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_SETTINGS.agentEnvByProvider,
      codex: [expect.objectContaining({ key: '', value: '', enabled: true })],
    })
    fireEvent.click(screen.getByTestId('settings-agent-configure-done-codex'))
    expect(screen.queryByTestId('settings-agent-detail-codex')).toBeNull()
    expect(screen.getByTestId('settings-agent-configure-codex')).toHaveFocus()
  })

  it('keeps existing environment rows visible and preserves their identity and order', () => {
    const props = createProps()
    const rows = [
      { id: 'first', key: 'NAME', value: 'one', enabled: true },
      { id: 'second', key: 'OTHER', value: 'two', enabled: false },
    ]
    props.settings = {
      ...props.settings,
      agentEnvByProvider: { ...props.settings.agentEnvByProvider, codex: rows },
    }
    const { container } = render(
      <AgentSettingsPage {...props} requestedProvider="codex" requestKey={1} />,
    )
    expect(
      container.querySelector('#settings-agent-env-codex')?.closest('details'),
    ).toHaveAttribute('open')
    fireEvent.change(screen.getByDisplayValue('one'), { target: { value: 'edited' } })
    expect(props.onChangeAgentEnvByProvider).toHaveBeenLastCalledWith({
      ...props.settings.agentEnvByProvider,
      codex: [{ ...rows[0], value: 'edited' }, rows[1]],
    })
    fireEvent.click(screen.getByTestId('settings-agent-env-move-up-codex-second'))
    expect(props.onChangeAgentEnvByProvider).toHaveBeenLastCalledWith({
      ...props.settings.agentEnvByProvider,
      codex: [rows[1], rows[0]],
    })
  })

  it('keeps the same installation owner and configured CLI override while navigating between list and detail', async () => {
    const props = createProps()
    props.settings = {
      ...props.settings,
      agentExecutablePathOverrideByProvider: {
        ...props.settings.agentExecutablePathOverrideByProvider,
        codex: '/custom/codex',
      },
    }
    const list = vi
      .fn()
      .mockResolvedValueOnce({ availabilityByProvider: { codex: availability('unavailable') } })
      .mockResolvedValue({ availabilityByProvider: { codex: availability('available') } })
    let complete!: (value: { availability: AgentProviderAvailability }) => void
    const install = vi.fn(
      () =>
        new Promise<{ availability: AgentProviderAvailability }>(resolve => {
          complete = resolve
        }),
    )
    installApi(list, install)
    const { container } = render(<AgentSettingsPage {...props} />)
    await waitFor(() =>
      expect(screen.getByTestId('settings-agent-executable-install-codex')).toBeEnabled(),
    )
    fireEvent.click(screen.getByTestId('settings-agent-executable-install-codex'))
    fireEvent.click(screen.getByTestId('settings-agent-configure-codex'))
    expect(screen.getByTestId('settings-agent-executable-install-codex')).toHaveTextContent(
      'Installing',
    )
    expect(screen.getByTestId('settings-agent-executable-install-codex')).toBeDisabled()
    expect(
      container.querySelector('#settings-agent-runtime-codex')?.closest('details'),
    ).not.toHaveAttribute('open')
    await act(async () => complete({ availability: availability('available') }))
    await waitFor(() =>
      expect(screen.getByTestId('settings-agent-executable-install-codex')).toHaveTextContent(
        'Installed',
      ),
    )
    fireEvent.click(screen.getByTestId('settings-agent-configure-done-codex'))
    expect(screen.getByTestId('settings-agent-executable-install-codex')).toHaveTextContent(
      'Installed',
    )
    expect(install).toHaveBeenCalledOnce()
    expect(list).toHaveBeenLastCalledWith({
      executablePathOverrideByProvider: props.settings.agentExecutablePathOverrideByProvider,
    })
  })

  it('leaves installation errors visible outside the collapsed executable information', async () => {
    installApi(
      vi.fn().mockResolvedValue({ availabilityByProvider: { codex: availability('unavailable') } }),
      vi.fn().mockRejectedValue(new Error('installation failed')),
    )
    render(<AgentSettingsPage {...createProps()} requestedProvider="codex" requestKey={1} />)
    await waitFor(() =>
      expect(screen.getByTestId('settings-agent-executable-install-codex')).toBeEnabled(),
    )
    fireEvent.click(screen.getByTestId('settings-agent-executable-install-codex'))
    const error = await screen.findByTestId('settings-agent-executable-install-error-codex')
    expect(error).toHaveTextContent('installation failed')
    expect(error.closest('details')).toBeNull()
  })
})
