export type SpaceTrustLevel = 'trusted' | 'restricted' | 'untrusted'

export interface SpaceBoundaryScope {
  rootPath: string
  rootUri: string
}

export interface SpaceBoundary {
  allowedMountIds: string[]
  scopesByMountId: Record<string, SpaceBoundaryScope>
  allowedPluginIds: string[] | null
  capabilities: string[] | null
  trustLevel: SpaceTrustLevel | null
}

export const EMPTY_SPACE_BOUNDARY: SpaceBoundary = {
  allowedMountIds: [],
  scopesByMountId: {},
  allowedPluginIds: null,
  capabilities: null,
  trustLevel: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(item => item.length > 0),
    ),
  ]
}

function normalizeNullableStringArray(value: unknown): string[] | null {
  return value === null || value === undefined ? null : normalizeStringArray(value)
}

function normalizeTrustLevel(value: unknown): SpaceTrustLevel | null {
  return value === 'trusted' || value === 'restricted' || value === 'untrusted' ? value : null
}

export function normalizeSpaceBoundary(value: unknown): SpaceBoundary {
  if (!isRecord(value)) {
    return { ...EMPTY_SPACE_BOUNDARY }
  }

  const allowedMountIds = normalizeStringArray(value.allowedMountIds)
  const scopesByMountId: Record<string, SpaceBoundaryScope> = {}

  if (isRecord(value.scopesByMountId)) {
    for (const mountId of allowedMountIds) {
      const scope = value.scopesByMountId[mountId]
      if (!isRecord(scope)) {
        continue
      }

      const rootPath = typeof scope.rootPath === 'string' ? scope.rootPath.trim() : ''
      const rootUri = typeof scope.rootUri === 'string' ? scope.rootUri.trim() : ''
      if (rootPath.length === 0) {
        continue
      }

      scopesByMountId[mountId] = { rootPath, rootUri }
    }
  }

  return {
    allowedMountIds,
    scopesByMountId,
    allowedPluginIds: normalizeNullableStringArray(value.allowedPluginIds),
    capabilities: normalizeNullableStringArray(value.capabilities),
    trustLevel: normalizeTrustLevel(value.trustLevel),
  }
}

export function isSpaceBoundaryEmpty(boundary: SpaceBoundary | null | undefined): boolean {
  return !boundary || boundary.allowedMountIds.length === 0
}

export function createMountOnlySpaceBoundary(options: {
  mountId: string | null | undefined
  rootPath: string
  rootUri?: string | null
}): SpaceBoundary {
  const mountId = typeof options.mountId === 'string' ? options.mountId.trim() : ''
  const rootPath = options.rootPath.trim()
  if (mountId.length === 0 || rootPath.length === 0) {
    return { ...EMPTY_SPACE_BOUNDARY }
  }

  return {
    ...EMPTY_SPACE_BOUNDARY,
    allowedMountIds: [mountId],
    scopesByMountId: {
      [mountId]: {
        rootPath,
        rootUri: options.rootUri?.trim() ?? '',
      },
    },
  }
}
