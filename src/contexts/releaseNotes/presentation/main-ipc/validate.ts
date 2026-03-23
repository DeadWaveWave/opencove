import type {
  GetReleaseNotesAutoRangeInput,
  GetReleaseNotesRangeInput,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function normalizeVersion(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function normalizeLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  return value
}

function isValidVersion(value: string): boolean {
  // Accept semver-ish values (e.g. 0.2.0, 0.2.0-nightly.20260321.1)
  return value.length > 0 && value.length <= 128 && /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value)
}

export function normalizeGetReleaseNotesRangePayload(payload: unknown): GetReleaseNotesRangeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'release-notes:get-range payload must be an object',
    })
  }

  const fromVersion = normalizeVersion(payload.fromVersion)
  const toVersion = normalizeVersion(payload.toVersion)
  const limit = normalizeLimit(payload.limit)

  if (!isValidVersion(fromVersion) || !isValidVersion(toVersion)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'release-notes:get-range payload is missing valid fromVersion/toVersion',
    })
  }

  return {
    fromVersion,
    toVersion,
    ...(limit === undefined ? {} : { limit }),
  }
}

export function normalizeGetReleaseNotesAutoRangePayload(
  payload: unknown,
): GetReleaseNotesAutoRangeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'release-notes:get-auto-range payload must be an object',
    })
  }

  const toVersion = normalizeVersion(payload.toVersion)
  const limit = normalizeLimit(payload.limit)

  if (!isValidVersion(toVersion)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'release-notes:get-auto-range payload is missing a valid toVersion',
    })
  }

  return {
    toVersion,
    ...(limit === undefined ? {} : { limit }),
  }
}
