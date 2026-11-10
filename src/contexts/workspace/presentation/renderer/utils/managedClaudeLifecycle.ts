import { createAppError, toAppErrorDescriptor } from '@shared/errors/appError'
import type { GetManagedClaudeBindingResult } from '@shared/contracts/managedClaudeLaunch'
import type { ManagedClaudeBindingObservation } from '@shared/contracts/managedClaudeLaunch'

async function readOwnership(nodeId: string): Promise<GetManagedClaudeBindingResult> {
  let result: GetManagedClaudeBindingResult
  try {
    result = await window.opencoveApi.controlSurface.invoke<GetManagedClaudeBindingResult>({
      kind: 'query',
      id: 'node.managedClaudeBinding',
      payload: { nodeId },
    })
  } catch (error) {
    if (toAppErrorDescriptor(error).code !== 'common.invalid_input') {
      throw error
    }
    // Negotiate with the runtime registry, never infer support from error text or app version.
    const registry = await window.opencoveApi.controlSurface.invoke<{
      protocolVersion: number
      operations: { id: string }[]
    }>({ kind: 'query', id: 'system.operations', payload: {} })
    if (
      !registry ||
      typeof registry.protocolVersion !== 'number' ||
      !Array.isArray(registry.operations) ||
      !registry.operations.every(operation => operation && typeof operation.id === 'string')
    ) {
      throw createAppError('persistence.unavailable')
    }
    if (registry.operations.some(operation => operation.id === 'node.managedClaudeBinding')) {
      throw error
    }
    return { managedClaudeBinding: null, retired: false, executionDirectory: null }
  }
  if (!result || typeof result.retired !== 'boolean' || result.managedClaudeBinding === undefined) {
    throw createAppError('persistence.unavailable')
  }
  if (result.retired) {
    throw createAppError('agent.managed_launch_rejected', {
      details: { nodeId, reason: 'nodeGone' },
    })
  }
  return result
}

/** Query durable ownership at interaction start; never infer it from renderer metadata. */
export async function readManagedClaudeBinding(
  nodeId: string,
  provider?: string,
): Promise<ManagedClaudeBindingObservation | null> {
  if (provider !== 'claude-code' || !window.opencoveApi?.controlSurface?.invoke) {
    return null
  }
  const result = await readOwnership(nodeId)
  return result.managedClaudeBinding
}

export async function killUnownedNodeRuntime(node: {
  id: string
  data: { kind?: string; sessionId: string; agent?: { provider: string } | null }
}): Promise<void> {
  if (!node.data.sessionId) {
    return
  }
  if (node.data.agent?.provider !== 'claude-code' || !window.opencoveApi?.controlSurface?.invoke) {
    await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })
    return
  }
  // A failed ownership read cannot authorize speculative deletion cleanup.
  const binding = await readManagedClaudeBinding(node.id, node.data.agent?.provider)
  if (!binding) {
    await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })
  }
}

/** Task reuse needs the saved directory before it can persist any display/relationship edits. */
export async function readManagedClaudeExecutionContext(
  nodeId: string,
  provider?: string,
): Promise<{ binding: ManagedClaudeBindingObservation; executionDirectory: string | null } | null> {
  if (provider !== 'claude-code' || !window.opencoveApi?.controlSurface?.invoke) {
    return null
  }
  const result = await readOwnership(nodeId)
  if (!result?.managedClaudeBinding) {
    return null
  }
  return {
    binding: result.managedClaudeBinding,
    executionDirectory: result.executionDirectory,
  }
}
