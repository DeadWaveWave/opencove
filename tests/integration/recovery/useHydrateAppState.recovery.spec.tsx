import React, { useState } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'

const { readPersistedStateWithMeta } = vi.hoisted(() => ({
  readPersistedStateWithMeta: vi.fn(),
}))

vi.mock('../../../src/contexts/workspace/presentation/renderer/utils/persistence', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/contexts/workspace/presentation/renderer/utils/persistence')
  >('../../../src/contexts/workspace/presentation/renderer/utils/persistence')

  return {
    ...actual,
    readPersistedStateWithMeta,
  }
})

import { useHydrateAppState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState'

describe('useHydrateAppState recovery notice', () => {
  beforeEach(() => {
    useAppStore.getState().setPersistNotice(null)
    readPersistedStateWithMeta.mockReset()
  })

  it('surfaces persistence recovery reasons via app store notice', async () => {
    readPersistedStateWithMeta.mockResolvedValue({
      state: null,
      recovery: 'corrupt_db',
    })

    function Harness() {
      const [_agentSettings, setAgentSettings] = useState(DEFAULT_AGENT_SETTINGS)
      const _workspaces = useAppStore(state => state.workspaces)
      const _activeWorkspaceId = useAppStore(state => state.activeWorkspaceId)

      const { isHydrated } = useHydrateAppState({
        activeWorkspaceId: _activeWorkspaceId,
        setAgentSettings,
      })

      return <div data-testid="hydrated">{String(isHydrated)}</div>
    }

    render(<Harness />)

    await waitFor(() => {
      expect(useAppStore.getState().persistNotice).toEqual({
        tone: 'warning',
        message: 'Persistence database was corrupted and has been reset.',
        kind: 'recovery',
      })
    })
  })
})
