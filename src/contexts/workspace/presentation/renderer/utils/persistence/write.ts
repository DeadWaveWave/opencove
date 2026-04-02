import type { PersistedAppState } from '../../types'
import { createAppErrorDescriptor, toAppErrorDescriptor } from '@shared/errors/appError'
import { PERSISTED_APP_STATE_FORMAT_VERSION } from './constants'
import type { PersistWriteResult } from './types'
import { getPersistencePort } from './port'
import {
  persistLocalViewStateFromAppState,
  stripLocalViewStateFromPersistedState,
} from './viewState'

let lastSuccessfulSharedState: { portKind: string; raw: string } | null = null

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
  const sharedStateRaw = JSON.stringify(sharedState)

  if (
    lastSuccessfulSharedState?.portKind === port.kind &&
    lastSuccessfulSharedState.raw === sharedStateRaw
  ) {
    return { ok: true, level: 'full', bytes: 0 }
  }

  let fullResult: PersistWriteResult
  try {
    fullResult = await port.writeAppState(sharedState)
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
    lastSuccessfulSharedState = { portKind: port.kind, raw: sharedStateRaw }
    return { ok: true, level: 'full', bytes: fullResult.bytes }
  }

  if (fullResult.reason !== 'quota' && fullResult.reason !== 'payload_too_large') {
    return fullResult
  }

  const degradedState = stripScrollbackFromState(sharedState)
  const degradedRaw = JSON.stringify(degradedState)
  const degradedResult = await port.writeAppState(degradedState)
  if (degradedResult.ok) {
    lastSuccessfulSharedState = { portKind: port.kind, raw: degradedRaw }
    return { ok: true, level: 'no_scrollback', bytes: degradedResult.bytes }
  }

  if (degradedResult.reason !== 'quota' && degradedResult.reason !== 'payload_too_large') {
    return degradedResult
  }

  const minimalState = settingsOnlyState(sharedState)
  const minimalRaw = JSON.stringify(minimalState)
  const minimalResult = await port.writeAppState(minimalState)
  if (minimalResult.ok) {
    lastSuccessfulSharedState = { portKind: port.kind, raw: minimalRaw }
    return { ok: true, level: 'settings_only', bytes: minimalResult.bytes }
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

export function markPersistedStateAsSynced(state: PersistedAppState): void {
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
    lastSuccessfulSharedState = { portKind: port.kind, raw: JSON.stringify(sharedState) }
  } catch {
    // ignore cache failures
  }
}
