// Frozen from src/app/worker/workerConfigurationHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186. Function bodies unchanged.
import {
  normalizeHomeWorkerConfigInput,
  normalizeHomeWorkerWebUiSecurityInput,
  normalizeHomeWorkerWebUiSettingsInput,
} from './homeWorkerConfigurationInput'
export function normalizeMutationPayload<T>(
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

export const normalizeSetConfig = (payload: unknown) =>
  normalizeMutationPayload(payload, value => normalizeHomeWorkerConfigInput(value))

export const normalizeSetSettings = (payload: unknown) =>
  normalizeMutationPayload(payload, value => normalizeHomeWorkerWebUiSettingsInput(value))

export const normalizeSetSecurity = (payload: unknown) =>
  normalizeMutationPayload(payload, value => normalizeHomeWorkerWebUiSecurityInput(value))
