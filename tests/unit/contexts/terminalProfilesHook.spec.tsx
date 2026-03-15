import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTerminalProfiles } from '../../../src/app/renderer/shell/hooks/useTerminalProfiles'

function HookHost({ isSettingsOpen }: { isSettingsOpen: boolean }): React.JSX.Element {
  const { terminalProfiles, detectedDefaultTerminalProfileId } = useTerminalProfiles()

  return (
    <div>
      <span data-testid="terminal-profile-count">{terminalProfiles.length}</span>
      <span data-testid="terminal-default-profile">{detectedDefaultTerminalProfileId ?? ''}</span>
      <span data-testid="settings-open">{isSettingsOpen ? 'open' : 'closed'}</span>
    </div>
  )
}

describe('useTerminalProfiles', () => {
  it('loads terminal profiles once and reuses them when settings reopen', async () => {
    const listProfiles = vi.fn(async () => ({
      profiles: [
        { id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' as const },
        { id: 'wsl:Ubuntu', label: 'WSL (Ubuntu)', runtimeKind: 'wsl' as const },
      ],
      defaultProfileId: 'powershell',
    }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      value: {
        pty: {
          listProfiles,
        },
      },
    })

    const { rerender, unmount } = render(<HookHost isSettingsOpen={false} />)

    await waitFor(() => {
      expect(listProfiles).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByTestId('terminal-profile-count')).toHaveTextContent('2')
    expect(screen.getByTestId('terminal-default-profile')).toHaveTextContent('powershell')

    rerender(<HookHost isSettingsOpen={false} />)
    unmount()
    render(<HookHost isSettingsOpen={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('terminal-profile-count')).toHaveTextContent('2')
    })

    expect(listProfiles).toHaveBeenCalledTimes(1)
  })
})
