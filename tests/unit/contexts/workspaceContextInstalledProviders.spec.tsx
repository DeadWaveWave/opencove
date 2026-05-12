import React, { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
} from '../../../src/contexts/settings/domain/agentSettings'
import { useWorkspaceContextInstalledProviders } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/useWorkspaceContextInstalledProviders'

function Harness({ order }: { order: AgentProvider[] }) {
  const { sortedInstalledProviders, ensureInstalledProvidersLoaded } =
    useWorkspaceContextInstalledProviders({
      agentProviderOrder: order,
      agentExecutablePathOverrideByProvider:
        DEFAULT_AGENT_SETTINGS.agentExecutablePathOverrideByProvider,
    })

  useEffect(() => {
    ensureInstalledProvidersLoaded()
  }, [ensureInstalledProvidersLoaded])

  return (
    <div>
      {sortedInstalledProviders.map(provider => (
        <span data-testid={`provider-${provider}`} key={provider}>
          {provider}
        </span>
      ))}
    </div>
  )
}

describe('useWorkspaceContextInstalledProviders', () => {
  afterEach(() => {
    delete (window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi
  })

  it('keeps host-unavailable providers launchable unless an override is misconfigured', async () => {
    const listInstalledProviders = vi.fn(async () => ({
      providers: ['codex' as const],
      availabilityByProvider: {
        'claude-code': {
          provider: 'claude-code' as const,
          command: 'claude',
          status: 'unavailable' as const,
          executablePath: null,
          source: null,
          diagnostics: ['Unable to resolve claude from current process PATH.'],
        },
        codex: {
          provider: 'codex' as const,
          command: 'codex',
          status: 'available' as const,
          executablePath: '/usr/local/bin/codex',
          source: 'process_path' as const,
          diagnostics: [],
        },
        opencode: {
          provider: 'opencode' as const,
          command: 'opencode',
          status: 'misconfigured' as const,
          executablePath: null,
          source: null,
          diagnostics: ['Configured override was not executable.'],
        },
        gemini: {
          provider: 'gemini' as const,
          command: 'gemini',
          status: 'misconfigured' as const,
          executablePath: null,
          source: null,
          diagnostics: ['Configured override was not executable.'],
        },
      },
      fetchedAt: '2026-05-12T00:00:00.000Z',
    }))

    ;(window as typeof window & { opencoveApi?: Window['opencoveApi'] }).opencoveApi = {
      agent: {
        listInstalledProviders,
      },
    } as Window['opencoveApi']

    render(<Harness order={['codex', 'claude-code', 'opencode', 'gemini']} />)

    await waitFor(() => {
      expect(screen.getByTestId('provider-codex')).toBeVisible()
      expect(screen.getByTestId('provider-claude-code')).toBeVisible()
    })
    expect(screen.queryByTestId('provider-opencode')).toBeNull()
    expect(screen.queryByTestId('provider-gemini')).toBeNull()
  })
})
