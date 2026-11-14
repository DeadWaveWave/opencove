import {
  recordPendingPublication,
  content,
  persistenceScope,
  getSyncedPersistedState,
  isPublicationBlocked,
} from './publicationState'
import { requestCanonicalRefresh } from './canonicalRefresh'
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

export function parsePersistedStateValue(value: unknown): {
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

export interface PersistedStateReadResult {
  revision: number | null
  state: PersistedAppState | null
  recovery: PersistenceRecoveryReason | null
  hasStandardWindowSizeBucket: boolean
  // @compat storage-cove-m0-keys
  /** False when legacy data can be restored but its durable migration failed. */
  isPersisted: boolean
}

export async function readPersistedStateWithMeta(): Promise<PersistedStateReadResult> {
  const port = getPersistencePort()
  if (!port) {
    return {
      revision: null,
      state: null,
      recovery: null,
      hasStandardWindowSizeBucket: false,
      isPersisted: false,
    }
  }

  const primary = await port.readAppState()
  const recovery = primary?.recovery ?? null

  if (primary?.state) {
    const parsed = parsePersistedStateValue(primary.state)
    if (parsed.state) {
      const state = applyLocalViewStateToPersistedState(parsed.state)
      // @compat storage-cove-m0-keys
      const legacyRaw = port.kind === 'ipc' ? readLegacyLocalStorageRaw() : null
      // @compat storage-cove-m0-keys
      const legacy = legacyRaw ? parseRawPersistedState(legacyRaw) : null
      // @compat storage-cove-m0-keys
      if (legacy) {
        try {
          await migrateTerminalScrollback(legacy, parsed.state, port)
        } catch {
          return {
            revision: primary.revision ?? null,
            state,
            recovery,
            hasStandardWindowSizeBucket: parsed.hasStandardWindowSizeBucket,
            isPersisted: false,
          }
        }
      }
      return {
        revision: primary.revision ?? null,
        state,
        recovery,
        hasStandardWindowSizeBucket: parsed.hasStandardWindowSizeBucket,
        isPersisted: true,
      }
    }
  }

  if (port.kind !== 'ipc') {
    return {
      revision: null,
      state: null,
      recovery,
      hasStandardWindowSizeBucket: false,
      isPersisted: false,
    }
  }

  // @compat storage-cove-m0-keys
  const legacyRaw = readLegacyLocalStorageRaw()
  // @compat storage-cove-m0-keys
  if (!legacyRaw) {
    return {
      revision: null,
      state: null,
      recovery,
      hasStandardWindowSizeBucket: false,
      isPersisted: false,
    }
  }

  // @compat storage-cove-m0-keys
  const legacyParsed = parseRawPersistedState(legacyRaw)
  // @compat storage-cove-m0-keys
  if (!legacyParsed) {
    return {
      revision: null,
      state: null,
      recovery,
      hasStandardWindowSizeBucket: false,
      isPersisted: false,
    }
  }

  if (isPublicationBlocked()) {
    return {
      revision: null,
      // @compat storage-cove-m0-keys
      state: legacyParsed,
      recovery,
      hasStandardWindowSizeBucket: false,
      isPersisted: false,
    }
  }
  // @compat storage-cove-m0-keys
  const migratedState = stripScrollbackFromState(legacyParsed)
  // Migrate the persisted envelope directly, including its disclosure fields.
  // Live presentation state changes only when the caller accepts this snapshot.
  persistLocalViewStateFromAppState(migratedState)
  const migrationScope = persistenceScope()
  const migrationBase = getSyncedPersistedState()
  const migratedAppStateResult = await port.writeAppState(
    stripLocalViewStateFromPersistedState(migratedState),
  )
  if (!migratedAppStateResult.ok) {
    if (migratedAppStateResult.outcome === 'unknown') {
      recordPendingPublication(
        {
          candidateRaw: content(migratedState),
          draftRaw: content(migratedState),
          ancestorRaw: migrationBase ? content(migrationBase) : null,
          kind: 'uncertain-refresh',
          minimumRevision: null,
          unknownOutcome: true,
        },
        migrationScope,
      )
    }
    return {
      revision: null,
      state: migratedState,
      recovery,
      hasStandardWindowSizeBucket: false,
      isPersisted: false,
    }
  }

  if (
    migratedAppStateResult.corrected ||
    migratedAppStateResult.merged ||
    migratedAppStateResult.uncertain
  ) {
    requestCanonicalRefresh({ reason: 'merged', minimumRevision: migratedAppStateResult.revision })
    try {
      const snapshot = await port.readAppState()
      const canonical = parsePersistedStateValue(snapshot?.state)
      if (
        !canonical.state ||
        snapshot?.revision === null ||
        snapshot?.revision === undefined ||
        snapshot.revision < (migratedAppStateResult.revision ?? 0)
      ) {
        throw new Error('Migration is awaiting the saved workspace.')
      }
      // @compat storage-cove-m0-keys
      await migrateTerminalScrollback(legacyParsed, canonical.state, port)
      return {
        revision: snapshot.revision,
        state: applyLocalViewStateToPersistedState(canonical.state),
        recovery,
        hasStandardWindowSizeBucket: canonical.hasStandardWindowSizeBucket,
        isPersisted: true,
      }
    } catch {
      return {
        revision: null,
        state: migratedState,
        recovery,
        hasStandardWindowSizeBucket: false,
        isPersisted: false,
      }
    }
  }

  try {
    // @compat storage-cove-m0-keys
    await migrateTerminalScrollback(legacyParsed, migratedState, port)
  } catch {
    return {
      revision: null,
      state: migratedState,
      recovery,
      hasStandardWindowSizeBucket: false,
      isPersisted: false,
    }
  }

  return {
    revision: migratedAppStateResult.revision ?? null,
    state: applyLocalViewStateToPersistedState(migratedState),
    recovery,
    hasStandardWindowSizeBucket: false,
    isPersisted: true,
  }
}

export async function readPersistedState(): Promise<PersistedAppState | null> {
  const { state } = await readPersistedStateWithMeta()
  return state
}

// @compat storage-cove-m0-keys
async function migrateTerminalScrollback(
  legacy: PersistedAppState,
  canonical: PersistedAppState,
  port: NonNullable<ReturnType<typeof getPersistencePort>>,
): Promise<void> {
  const surviving = new Set(
    canonical.workspaces
      .flatMap(w => w.nodes)
      .filter(n => n.kind === 'terminal')
      .map(n => n.id),
  )
  await Promise.all(
    legacy.workspaces
      .flatMap(w => w.nodes)
      .filter(
        n =>
          n.kind === 'terminal' &&
          surviving.has(n.id) &&
          typeof n.scrollback === 'string' &&
          n.scrollback.length > 0,
      )
      .map(async node => {
        if ((await port.readNodeScrollback(node.id)) !== null) {
          return
        }
        const result = await port.writeNodeScrollback(node.id, node.scrollback)
        if (!result.ok) {
          throw new Error('Terminal history could not be saved.')
        }
      }),
  )
}
