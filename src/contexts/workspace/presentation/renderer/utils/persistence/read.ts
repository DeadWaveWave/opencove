import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState, PersistedWorkspaceState } from '../../types'
import { ensurePersistedWorkspace } from './ensure'
import { getPersistencePort, readLegacyLocalStorageRaw } from './port'
import type { PersistenceRecoveryReason } from '@shared/contracts/dto'
import {
  applyLocalViewStateToPersistedState,
  persistLocalViewStateFromAppState,
  stripLocalViewStateFromPersistedState,
} from './viewState'
import { markPersistedStateAsSynced } from './write'

function parsePersistedStateValue(value: unknown): {
  state: PersistedAppState | null
  hasStandardWindowSizeBucket: boolean
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { state: null, hasStandardWindowSizeBucket: false }
  }

  const record = value as Record<string, unknown>
  const formatVersionRaw = record.formatVersion
  const formatVersion =
    typeof formatVersionRaw === 'number' &&
    Number.isFinite(formatVersionRaw) &&
    formatVersionRaw >= 0
      ? Math.floor(formatVersionRaw)
      : 0
  const activeWorkspaceId = record.activeWorkspaceId
  const workspaces = record.workspaces

  if (activeWorkspaceId !== null && typeof activeWorkspaceId !== 'string') {
    return { state: null, hasStandardWindowSizeBucket: false }
  }

  if (!Array.isArray(workspaces)) {
    return { state: null, hasStandardWindowSizeBucket: false }
  }

  const normalizedWorkspaces = workspaces
    .map(item => ensurePersistedWorkspace(item))
    .filter((item): item is PersistedWorkspaceState => item !== null)

  const settings = normalizeAgentSettings(record.settings)
  const hasStandardWindowSizeBucket =
    typeof record.settings === 'object' &&
    record.settings !== null &&
    !Array.isArray(record.settings) &&
    typeof (record.settings as Record<string, unknown>).standardWindowSizeBucket === 'string'

  return {
    state: {
      formatVersion,
      activeWorkspaceId,
      workspaces: normalizedWorkspaces,
      settings,
    },
    hasStandardWindowSizeBucket,
  }
}

function parseRawPersistedState(raw: string): PersistedAppState | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsePersistedStateValue(parsed).state
  } catch {
    return null
  }
}

function stripScrollbackFromState(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    workspaces: state.workspaces.map(workspace => ({
      ...workspace,
      nodes: workspace.nodes.map(node => ({ ...node, scrollback: null })),
    })),
  }
}

export async function readPersistedStateWithMeta(): Promise<{
  state: PersistedAppState | null
  recovery: PersistenceRecoveryReason | null
  hasStandardWindowSizeBucket: boolean
}> {
  const port = getPersistencePort()
  if (!port) {
    return { state: null, recovery: null, hasStandardWindowSizeBucket: false }
  }

  const primary = await port.readAppState()
  const recovery = primary?.recovery ?? null

  if (primary?.state) {
    const parsed = parsePersistedStateValue(primary.state)
    if (parsed.state) {
      const state = applyLocalViewStateToPersistedState(parsed.state)
      markPersistedStateAsSynced(state)
      return {
        state,
        recovery,
        hasStandardWindowSizeBucket: parsed.hasStandardWindowSizeBucket,
      }
    }
  }

  if (port.kind !== 'ipc') {
    return { state: null, recovery, hasStandardWindowSizeBucket: false }
  }

  const legacyRaw = readLegacyLocalStorageRaw()
  if (!legacyRaw) {
    return { state: null, recovery, hasStandardWindowSizeBucket: false }
  }

  const legacyParsed = parseRawPersistedState(legacyRaw)
  if (!legacyParsed) {
    return { state: null, recovery, hasStandardWindowSizeBucket: false }
  }

  const migratedState = stripScrollbackFromState(legacyParsed)
  persistLocalViewStateFromAppState(migratedState)
  const migratedAppStateResult = await port.writeAppState(
    stripLocalViewStateFromPersistedState(migratedState),
  )
  if (!migratedAppStateResult.ok) {
    return { state: migratedState, recovery, hasStandardWindowSizeBucket: false }
  }

  await Promise.allSettled(
    legacyParsed.workspaces.flatMap(workspace =>
      workspace.nodes
        .filter(
          node =>
            node.kind === 'terminal' &&
            typeof node.scrollback === 'string' &&
            node.scrollback.length > 0,
        )
        .map(node => port.writeNodeScrollback(node.id, node.scrollback)),
    ),
  )

  return {
    state: (() => {
      const state = applyLocalViewStateToPersistedState(migratedState)
      markPersistedStateAsSynced(state)
      return state
    })(),
    recovery,
    hasStandardWindowSizeBucket: false,
  }
}

export async function readPersistedState(): Promise<PersistedAppState | null> {
  const { state } = await readPersistedStateWithMeta()
  return state
}
