// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/integrationGithubMountHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; validator and helper bodies unchanged.
import { createAppError } from '../../../src/shared/errors/appError'
export function normalizeBranches(value: unknown, operationId: string): string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branches.`,
    })
  }

  return value.map(entry => entry.trim()).filter(entry => entry.length > 0)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeMountId(value: unknown, operationId: string): string {
  const mountId = normalizeOptionalString(value)
  if (!mountId) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} mountId.`,
    })
  }

  return mountId
}

export const normalizeResolveInMount = (
  payload: unknown,
): { mountId: string; branches: string[] } => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for integration.github.resolvePullRequestsInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'integration.github.resolvePullRequestsInMount'),
    branches: normalizeBranches(payload.branches, 'integration.github.resolvePullRequestsInMount'),
  }
}
