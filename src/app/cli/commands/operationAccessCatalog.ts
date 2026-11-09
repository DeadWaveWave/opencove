type Access = {
  access: 'allowed' | 'denied' | 'constrained'
  allowed?: boolean
  reason?: string
  policyVersion: string
  rejectedFields?: Record<string, string>
}
// Discovery is advisory; only a versioned Worker policy can claim caller access.
export function operationAccessInfo(value: unknown, version?: unknown): Access | undefined {
  if (!value || typeof value !== 'object') {
    return
  }
  const policy = value as Record<string, unknown>
  const policyVersion = version ?? policy.policyVersion
  const access = policy.access
  if (
    typeof policyVersion !== 'string' ||
    (access !== 'allowed' && access !== 'denied' && access !== 'constrained')
  ) {
    return
  }
  let rejectedFields: Record<string, string> | undefined
  if (policy.rejectedFields !== undefined) {
    if (
      !policy.rejectedFields ||
      typeof policy.rejectedFields !== 'object' ||
      Array.isArray(policy.rejectedFields)
    ) {
      return
    }
    const entries = Object.entries(policy.rejectedFields)
    if (entries.some(([, reason]) => typeof reason !== 'string')) {
      return
    }
    rejectedFields = Object.fromEntries(entries) as Record<string, string>
  }
  return {
    access,
    ...(access === 'constrained' ? {} : { allowed: access === 'allowed' }),
    ...(typeof policy.reason === 'string' ? { reason: policy.reason } : {}),
    policyVersion,
    ...(rejectedFields ? { rejectedFields } : {}),
  }
}

export function operationAccessCatalog(value: unknown) {
  const result = new Map<string, Access>()
  if (!value || typeof value !== 'object') {
    return result
  }
  const policy = value as Record<string, unknown>
  if (typeof policy.policyVersion !== 'string' || !Array.isArray(policy.operations)) {
    return result
  }
  for (const op of policy.operations) {
    const info = operationAccessInfo(op, policy.policyVersion)
    if (!op || typeof op.id !== 'string' || !info) {
      continue
    }
    result.set(op.id, info)
  }
  return result
}
