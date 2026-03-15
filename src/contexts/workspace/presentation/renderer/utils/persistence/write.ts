import type { PersistedAppState } from '../../types'
import { createAppErrorDescriptor, toAppErrorDescriptor } from '@shared/errors/appError'
import { PERSISTED_APP_STATE_FORMAT_VERSION } from './constants'
import type { PersistWriteResult } from './types'
import { getPersistencePort } from './port'
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

  let fullResult: PersistWriteResult
  try {
    fullResult = await port.writeAppState(normalizedState)
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
    return { ok: true, level: 'full', bytes: fullResult.bytes }
  }

  if (fullResult.reason !== 'quota' && fullResult.reason !== 'payload_too_large') {
    return fullResult
  }

  const degradedResult = await port.writeAppState(stripScrollbackFromState(normalizedState))
  if (degradedResult.ok) {
    return { ok: true, level: 'no_scrollback', bytes: degradedResult.bytes }
  }

  if (degradedResult.reason !== 'quota' && degradedResult.reason !== 'payload_too_large') {
    return degradedResult
  }

  const minimalResult = await port.writeAppState(settingsOnlyState(normalizedState))
  if (minimalResult.ok) {
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
