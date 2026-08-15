export interface NodeWorkerBinding {
  endpointId: string
  mountId: string | null
}

export function nodeWorkerBindingForMount(
  mount: { endpointId: string; mountId: string } | null | undefined,
): NodeWorkerBinding {
  return mount
    ? { endpointId: mount.endpointId, mountId: mount.mountId }
    : { endpointId: 'local', mountId: null }
}

export function normalizeNodeWorkerBinding(value: unknown): NodeWorkerBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const endpointId = typeof record.endpointId === 'string' ? record.endpointId.trim() : ''
  if (endpointId.length === 0) {
    return null
  }

  const mountId = typeof record.mountId === 'string' ? record.mountId.trim() : ''
  return {
    endpointId,
    mountId: mountId.length > 0 ? mountId : null,
  }
}

export function isRemoteNodeWorkerBinding(
  binding: NodeWorkerBinding | null | undefined,
): binding is NodeWorkerBinding {
  return binding !== null && binding !== undefined && binding.endpointId !== 'local'
}

export function areNodeWorkerBindingsEqual(
  left: NodeWorkerBinding | null | undefined,
  right: NodeWorkerBinding | null | undefined,
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.endpointId === right.endpointId && left.mountId === right.mountId
}
