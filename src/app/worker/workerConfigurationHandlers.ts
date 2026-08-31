import type {
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSecurityInput,
  SetHomeWorkerWebUiSettingsInput,
} from '../../shared/contracts/dto'
import {
  normalizeHomeWorkerConfigInput,
  normalizeWebUiSecurityInput,
  normalizeWebUiSettingsInput,
} from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfigMutations'
import type { ControlSurface } from '../main/controlSurface/controlSurface'
import type { WorkerConfigurationOwner } from './workerConfigurationOwner'

function requireNullPayload(payload: unknown): null {
  if (payload !== null) {
    throw new Error('Expected null Worker configuration query payload.')
  }
  return null
}

function normalizeMutationPayload<T>(
  payload: unknown,
  normalizeValue: (value: unknown) => T,
): { value: T; expectedUpdatedAt: string | null } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid Worker configuration mutation payload.')
  }
  const record = payload as Record<string, unknown>
  if (
    record.expectedUpdatedAt !== null &&
    (typeof record.expectedUpdatedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.expectedUpdatedAt)))
  ) {
    throw new Error('Invalid Worker configuration revision.')
  }
  if (!record.value || typeof record.value !== 'object' || Array.isArray(record.value)) {
    throw new Error('Invalid Worker configuration value.')
  }
  return {
    value: normalizeValue(record.value),
    expectedUpdatedAt: record.expectedUpdatedAt,
  }
}

export function registerWorkerConfigurationHandlers(
  controlSurface: ControlSurface,
  owner: WorkerConfigurationOwner,
): void {
  controlSurface.register('worker.config.get', {
    kind: 'query',
    validate: requireNullPayload,
    handle: async () => await owner.getSnapshot(),
    defaultErrorCode: 'worker.unavailable',
  })
  controlSurface.register('worker.config.set', {
    kind: 'command',
    validate: payload =>
      normalizeMutationPayload<SetHomeWorkerConfigInput>(payload, value =>
        normalizeHomeWorkerConfigInput(value as SetHomeWorkerConfigInput),
      ),
    handle: async (_ctx, payload) => await owner.setConfig(payload),
    defaultErrorCode: 'worker.unavailable',
  })
  controlSurface.register('worker.webAccess.setSettings', {
    kind: 'command',
    validate: payload =>
      normalizeMutationPayload<SetHomeWorkerWebUiSettingsInput>(payload, value =>
        normalizeWebUiSettingsInput(value),
      ),
    handle: async (_ctx, payload) => await owner.setWebUiSettings(payload),
    defaultErrorCode: 'worker.unavailable',
  })
  controlSurface.register('worker.webAccess.setSecurity', {
    kind: 'command',
    validate: payload =>
      normalizeMutationPayload<SetHomeWorkerWebUiSecurityInput>(payload, value =>
        normalizeWebUiSecurityInput(value as SetHomeWorkerWebUiSecurityInput),
      ),
    handle: async (_ctx, payload) => await owner.setWebUiSecurity(payload),
    defaultErrorCode: 'worker.unavailable',
  })
}
