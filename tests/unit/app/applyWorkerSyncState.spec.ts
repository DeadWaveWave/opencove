import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { applyWorkerSyncState } from '../../../src/app/renderer/shell/hooks/workerSync/applyWorkerSyncState'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

function workspace(id: string): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    nodes: [],
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
  } as unknown as WorkspaceState
}

describe('applyWorkerSyncState', () => {
  afterEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('writes workspaces first and settings second, both done before the caller continues', () => {
    const before = workspace('old')
    const after = workspace('new')
    const nextSettings = { ...DEFAULT_AGENT_SETTINGS, language: 'zh-CN' as const }
    useAppStore.setState({ workspaces: [before], activeWorkspaceId: 'old' })
    const oldSettings = useAppStore.getState().agentSettings
    const seen: Array<{ workspaces: WorkspaceState[]; settings: unknown }> = []
    const listener = vi.fn(() => {
      const state = useAppStore.getState()
      seen.push({ workspaces: state.workspaces, settings: state.agentSettings })
    })
    const unsubscribe = useAppStore.subscribe(listener)

    applyWorkerSyncState({ workspaces: [after], activeWorkspaceId: 'new', settings: nextSettings })
    // Stands in for acceptWorkerSyncSnapshot, which runs next and reads both fields.
    const atAccept = useAppStore.getState()
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(2)
    expect(seen[0].workspaces[0]).toBe(after)
    expect(seen[0].settings).toBe(oldSettings)
    expect(seen[1].workspaces[0]).toBe(after)
    expect(seen[1].settings).toBe(nextSettings)
    expect(atAccept.workspaces[0]).toBe(after)
    expect(atAccept.activeWorkspaceId).toBe('new')
    expect(atAccept.agentSettings).toBe(nextSettings)
  })

  it('does not write settings when they did not change', () => {
    useAppStore.setState({ workspaces: [workspace('old')], activeWorkspaceId: 'old' })
    const listener = vi.fn()
    const unsubscribe = useAppStore.subscribe(listener)

    applyWorkerSyncState({
      workspaces: [workspace('new')],
      activeWorkspaceId: 'new',
      settings: null,
    })
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
