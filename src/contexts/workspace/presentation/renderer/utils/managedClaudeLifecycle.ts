import { assertManagedClaudeWorkerCompatible } from '@shared/sync/managedClaudeWorkerCompatibility'
import { createAppError, toAppErrorDescriptor } from '@shared/errors/appError'
import type { GetManagedClaudeBindingResult } from '@shared/contracts/managedClaudeLaunch'
import type { ManagedClaudeBindingObservation } from '@shared/contracts/managedClaudeLaunch'
import type { ManagedClaudeLifecycleReceipt } from '@shared/contracts/managedClaudeLaunch'
import { supportsWorkerOperation } from './controlSurfaceOperationSupport'

export type ManagedClaudeOwnershipLookup =
  | { status: 'unsupported' }
  | { status: 'owned' | 'unowned'; result: GetManagedClaudeBindingResult }

export async function lookupManagedClaudeOwnership(
  nodeId: string,
): Promise<ManagedClaudeOwnershipLookup> {
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
    if (await supportsWorkerOperation('node.managedClaudeBinding')) {
      throw error
    }
    return { status: 'unsupported' }
  }
  if (!result || typeof result.retired !== 'boolean' || result.managedClaudeBinding === undefined) {
    throw createAppError('persistence.unavailable')
  }
  if (result.retired) {
    throw createAppError('agent.managed_launch_rejected', {
      details: { nodeId, reason: 'nodeGone' },
    })
  }
  return { status: result.managedClaudeBinding ? 'owned' : 'unowned', result }
}

async function readOwnership(nodeId: string): Promise<GetManagedClaudeBindingResult> {
  const lookup = await lookupManagedClaudeOwnership(nodeId)
  if (lookup.status === 'unsupported') {
    throw createAppError('agent.managed_launch_rejected', {
      details: { nodeId, reason: 'workerUpgradeRequired' },
      debugMessage:
        'Update and restart the connected Worker before managing Claude agents. Updating this window alone is not enough.',
    })
  }
  if (lookup.status === 'owned') {
    let capabilities: unknown
    try {
      capabilities = await window.opencoveApi.controlSurface.invoke({
        kind: 'query',
        id: 'system.capabilities',
        payload: {},
      })
    } catch (error) {
      if (toAppErrorDescriptor(error).code !== 'common.invalid_input') {
        throw error
      }
    }
    assertManagedClaudeWorkerCompatible(capabilities)
  }
  return lookup.result
}

export async function cleanupFailedNodePlacement(input: {
  sessionId: string
  managedClaudeLifecycle?: ManagedClaudeLifecycleReceipt
}): Promise<void> {
  if (!input.managedClaudeLifecycle) {
    await window.opencoveApi.pty.kill({ sessionId: input.sessionId })
    return
  }
  if (
    !window.opencoveApi?.controlSurface?.invoke ||
    !(await supportsWorkerOperation('session.cleanupUnreferenced'))
  ) {
    throw createAppError('agent.managed_launch_rejected', {
      details: {
        nodeId: input.managedClaudeLifecycle.binding.nodeId,
        reason: 'capabilityUnavailable',
      },
    })
  }
  await window.opencoveApi.controlSurface.invoke({
    kind: 'command',
    id: 'session.cleanupUnreferenced',
    payload: { sessionId: input.sessionId },
  })
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
