import type { GetCurrentReleaseNotesInput } from '../../../../shared/contracts/dto'
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

function normalizeLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function isValidVersion(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value)
}

function isValidLanguage(value: string | undefined): boolean {
  return (
    value === undefined || (value.length > 0 && value.length <= 32 && /^[A-Za-z0-9-]+$/.test(value))
  )
}

export function normalizeGetCurrentReleaseNotesPayload(
  payload: unknown,
): GetCurrentReleaseNotesInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'release-notes:get-current payload must be an object',
    })
  }

  const currentVersion = normalizeVersion(payload.currentVersion)
  const language = normalizeLanguage(payload.language)

  if (!isValidVersion(currentVersion) || !isValidLanguage(language)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'release-notes:get-current payload is missing a valid currentVersion/language',
    })
  }

  return {
    currentVersion,
    ...(language === undefined ? {} : { language }),
  }
}
