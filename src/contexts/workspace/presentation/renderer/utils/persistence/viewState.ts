import type { PersistedAppState, WorkspaceViewport } from '../../types'
import { DEFAULT_WORKSPACE_MINIMAP_VISIBLE, DEFAULT_WORKSPACE_VIEWPORT } from '../../types'
import { getStorage } from './storage'

const VIEW_STATE_STORAGE_KEY = 'opencove:m5.6:view-state'

type PersistedWorkspaceViewState = {
  viewport: WorkspaceViewport
  isMinimapVisible: boolean
  activeSpaceId: string | null
}

type PersistedAppViewState = {
  activeWorkspaceId: string | null
  workspaces: Record<string, PersistedWorkspaceViewState>
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeViewport(value: unknown): WorkspaceViewport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_WORKSPACE_VIEWPORT }
  }

  const record = value as Record<string, unknown>
  const x = typeof record.x === 'number' && Number.isFinite(record.x) ? record.x : 0
  const y = typeof record.y === 'number' && Number.isFinite(record.y) ? record.y : 0
  const zoom =
    typeof record.zoom === 'number' && Number.isFinite(record.zoom) && record.zoom > 0
      ? record.zoom
      : 1

  return { x, y, zoom }
}

function capturePersistedViewState(state: PersistedAppState): PersistedAppViewState {
  return {
    activeWorkspaceId: normalizeOptionalString(state.activeWorkspaceId),
    workspaces: Object.fromEntries(
      state.workspaces.map(workspace => [
        workspace.id,
        {
          viewport: normalizeViewport(workspace.viewport),
          isMinimapVisible:
            typeof workspace.isMinimapVisible === 'boolean'
              ? workspace.isMinimapVisible
              : DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
          activeSpaceId: normalizeOptionalString(workspace.activeSpaceId),
        },
      ]),
    ),
  }
}

function readPersistedViewState(): PersistedAppViewState | null {
  const storage = getStorage()
  if (!storage) {
    return null
  }

  const raw = storage.getItem(VIEW_STATE_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const record = parsed as Record<string, unknown>
    const workspacesInput = record.workspaces
    const workspaceEntries =
      workspacesInput && typeof workspacesInput === 'object' && !Array.isArray(workspacesInput)
        ? Object.entries(workspacesInput as Record<string, unknown>)
        : []

    return {
      activeWorkspaceId: normalizeOptionalString(record.activeWorkspaceId),
      workspaces: Object.fromEntries(
        workspaceEntries.map(([workspaceId, value]) => {
          const workspaceRecord =
            value && typeof value === 'object' && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : {}

          return [
            workspaceId,
            {
              viewport: normalizeViewport(workspaceRecord.viewport),
              isMinimapVisible:
                typeof workspaceRecord.isMinimapVisible === 'boolean'
                  ? workspaceRecord.isMinimapVisible
                  : DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
              activeSpaceId: normalizeOptionalString(workspaceRecord.activeSpaceId),
            },
          ]
        }),
      ),
    }
  } catch {
    return null
  }
}

function writePersistedViewState(state: PersistedAppViewState): void {
  const storage = getStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(VIEW_STATE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore local view persistence failures
  }
}

function resolveSanitizedActiveSpaceId(
  workspace: PersistedAppState['workspaces'][number],
): string | null {
  const firstSpaceId = workspace.spaces[0]?.id ?? null
  return normalizeOptionalString(firstSpaceId)
}

export function stripLocalViewStateFromPersistedState(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    activeWorkspaceId: state.workspaces[0]?.id ?? null,
    workspaces: state.workspaces.map(workspace => ({
      ...workspace,
      viewport: { ...DEFAULT_WORKSPACE_VIEWPORT },
      isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
      activeSpaceId: resolveSanitizedActiveSpaceId(workspace),
    })),
  }
}

export function persistLocalViewStateFromAppState(state: PersistedAppState): void {
  writePersistedViewState(capturePersistedViewState(state))
}

export function applyLocalViewStateToPersistedState(state: PersistedAppState): PersistedAppState {
  const existing = readPersistedViewState()
  const viewState = existing ?? capturePersistedViewState(state)

  if (!existing) {
    writePersistedViewState(viewState)
  }

  return {
    ...state,
    activeWorkspaceId:
      viewState.activeWorkspaceId &&
      state.workspaces.some(workspace => workspace.id === viewState.activeWorkspaceId)
        ? viewState.activeWorkspaceId
        : state.activeWorkspaceId,
    workspaces: state.workspaces.map(workspace => {
      const workspaceView = viewState.workspaces[workspace.id]
      if (!workspaceView) {
        return workspace
      }

      const activeSpaceId =
        workspaceView.activeSpaceId &&
        workspace.spaces.some(space => space.id === workspaceView.activeSpaceId)
          ? workspaceView.activeSpaceId
          : workspace.activeSpaceId

      return {
        ...workspace,
        viewport: normalizeViewport(workspaceView.viewport),
        isMinimapVisible:
          typeof workspaceView.isMinimapVisible === 'boolean'
            ? workspaceView.isMinimapVisible
            : workspace.isMinimapVisible,
        activeSpaceId,
      }
    }),
  }
}
