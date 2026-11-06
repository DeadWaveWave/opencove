import { canonicalContent } from '@shared/sync/mergeValue'
import { normalizePersistedAppStateForMerge } from '@shared/sync/normalizePersistedAppStateForMerge'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState } from '../../types'
import { createAppErrorDescriptor, toAppErrorDescriptor } from '@shared/errors/appError'
import { PERSISTED_APP_STATE_FORMAT_VERSION } from './constants'
import type { PersistWriteResult } from './types'
import { getPersistencePort } from './port'
import { publishSharedState } from './reconcilePublication'
import {
  persistLocalViewStateFromAppState,
  stripLocalViewStateFromPersistedState,
} from './viewState'

let lastSuccessfulSharedState: { portKind: string; raw: string; revision: number | null } | null =
  null
let pendingMergedPublication: { portKind: string; raw: string } | null = null
let allowNextEmptyWorkspaceOverwrite = false

export function content(state: PersistedAppState): string {
  return canonicalContent(
    normalizePersistedAppStateForMerge(state, normalizeAgentSettings) ?? state,
  )!
}

// Parse each accepted canonical base once; projection never reserializes the base.
let parsedSyncedBase: { raw: string; state: PersistedAppState } | null = null

export function getSyncedPersistedState(): PersistedAppState | null {
  if (
    !lastSuccessfulSharedState ||
    lastSuccessfulSharedState.portKind !== getPersistencePort()?.kind
  ) {
    return null
  }
  if (parsedSyncedBase?.raw !== lastSuccessfulSharedState.raw) {
    parsedSyncedBase = {
      raw: lastSuccessfulSharedState.raw,
      state: JSON.parse(lastSuccessfulSharedState.raw) as PersistedAppState,
    }
  }
  return parsedSyncedBase.state
}

function stripScrollbackFromState(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    workspaces: state.workspaces.map(workspace => ({
      ...workspace,
      nodes: workspace.nodes.map(node => ({
        ...node,
        scrollback: null,
      })),
    })),
  }
}

function settingsOnlyState(state: PersistedAppState): PersistedAppState {
  return {
    formatVersion: state.formatVersion,
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: [],
    settings: state.settings,
  }
}

function unavailableResult(): PersistWriteResult {
  return {
    ok: false,
    reason: 'unavailable',
    error: createAppErrorDescriptor('persistence.unavailable'),
  }
}

export async function writePersistedState(state: PersistedAppState): Promise<PersistWriteResult> {
  const shouldAllowNextEmptyWorkspaceOverwrite = allowNextEmptyWorkspaceOverwrite
  allowNextEmptyWorkspaceOverwrite = false

  const port = getPersistencePort()
  if (!port) {
    return unavailableResult()
  }

  const normalizedState: PersistedAppState = {
    ...state,
    formatVersion: PERSISTED_APP_STATE_FORMAT_VERSION,
  }
  persistLocalViewStateFromAppState(normalizedState)
  const sharedState = stripLocalViewStateFromPersistedState(normalizedState)
  const sharedStateRaw = content(sharedState)

  const pending = pendingMergedPublication?.portKind === port.kind ? pendingMergedPublication : null
  if (pending?.raw === sharedStateRaw) {
    return { ok: true, level: 'full', bytes: 0, merged: true }
  }
  if (
    !pending &&
    lastSuccessfulSharedState?.portKind === port.kind &&
    lastSuccessfulSharedState.raw === sharedStateRaw
  ) {
    return { ok: true, level: 'full', bytes: 0 }
  }

  let fullResult: PersistWriteResult
  const writeOptions = {
    baseRevision:
      lastSuccessfulSharedState?.portKind === port.kind
        ? lastSuccessfulSharedState.revision
        : undefined,
    allowEmptyWorkspaceOverwrite:
      shouldAllowNextEmptyWorkspaceOverwrite === true && sharedState.workspaces.length === 0,
  }

  try {
    fullResult = await publishSharedState(port, sharedState, pending?.raw ?? null, writeOptions)
  } catch (error) {
    return {
      ok: false,
      reason: 'unknown',
      error: createAppErrorDescriptor('persistence.invalid_state', {
        debugMessage: toAppErrorDescriptor(error).debugMessage,
      }),
    }
  }

  if (fullResult.ok) {
    if (fullResult.merged) {
      pendingMergedPublication = { portKind: port.kind, raw: sharedStateRaw }
    } else {
      pendingMergedPublication = null
      lastSuccessfulSharedState = {
        portKind: port.kind,
        raw: sharedStateRaw,
        revision: fullResult.revision ?? null,
      }
    }
    return fullResult
  }

  if (fullResult.reason !== 'quota' && fullResult.reason !== 'payload_too_large') {
    return fullResult
  }

  const degradedState = stripScrollbackFromState(sharedState)
  const degradedRaw = content(degradedState)
  const degradedResult = await publishSharedState(
    port,
    degradedState,
    pending?.raw ?? null,
    writeOptions,
  )
  if (degradedResult.ok) {
    if (degradedResult.merged) {
      pendingMergedPublication = { portKind: port.kind, raw: degradedRaw }
    } else {
      pendingMergedPublication = null
      lastSuccessfulSharedState = {
        portKind: port.kind,
        raw: degradedRaw,
        revision: degradedResult.revision ?? null,
      }
    }
    return { ...degradedResult, level: 'no_scrollback' }
  }

  if (degradedResult.reason !== 'quota' && degradedResult.reason !== 'payload_too_large') {
    return degradedResult
  }

  const minimalState = settingsOnlyState(sharedState)
  const minimalRaw = content(minimalState)
  const minimalResult = await publishSharedState(port, minimalState, pending?.raw ?? null, {
    baseRevision: writeOptions.baseRevision,
    allowEmptyWorkspaceOverwrite: writeOptions.allowEmptyWorkspaceOverwrite,
  })
  if (minimalResult.ok) {
    if (minimalResult.merged) {
      pendingMergedPublication = { portKind: port.kind, raw: minimalRaw }
    } else {
      pendingMergedPublication = null
      lastSuccessfulSharedState = {
        portKind: port.kind,
        raw: minimalRaw,
        revision: minimalResult.revision ?? null,
      }
    }
    return { ...minimalResult, level: 'settings_only' }
  }

  return minimalResult
}

export async function writeRawPersistedState(raw: string): Promise<PersistWriteResult> {
  const port = getPersistencePort()
  if (!port) {
    return unavailableResult()
  }

  try {
    return await port.writeWorkspaceStateRaw(raw)
  } catch (error) {
    return {
      ok: false,
      reason: 'unknown',
      error: createAppErrorDescriptor('persistence.invalid_state', {
        debugMessage: toAppErrorDescriptor(error).debugMessage,
      }),
    }
  }
}

export function markPersistedStateAsSynced(
  state: PersistedAppState,
  revision: number | null = null,
): void {
  const port = getPersistencePort()
  if (!port) {
    return
  }

  try {
    const normalizedState: PersistedAppState = {
      ...state,
      formatVersion: PERSISTED_APP_STATE_FORMAT_VERSION,
    }
    persistLocalViewStateFromAppState(normalizedState)
    const sharedState = stripLocalViewStateFromPersistedState(normalizedState)
    lastSuccessfulSharedState = { portKind: port.kind, raw: content(sharedState), revision }
    pendingMergedPublication = null
  } catch {
    // ignore cache failures
  }
}

export function allowNextEmptyWorkspacePersistedStateWrite(): void {
  allowNextEmptyWorkspaceOverwrite = true
}
