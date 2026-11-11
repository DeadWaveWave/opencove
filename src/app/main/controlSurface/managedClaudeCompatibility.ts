import type { ControlSurfaceContext } from './types'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createAppError } from '../../../shared/errors/appError'

export function managedClaudeWritesEnabled(): boolean {
  return process.env.OPENCOVE_MANAGED_CLAUDE_BINDINGS !== '0'
}
export function assertManagedClaudeMutationAllowed(
  ctx: ControlSurfaceContext,
  nodeId: string,
  enabled = true,
): void {
  const reason = !ctx.clientFeatures?.managedClaudeResumeBindingV1
    ? 'clientUpgradeRequired'
    : !enabled
      ? 'writesDisabled'
      : null
  if (reason) {
    throw createAppError('agent.managed_launch_rejected', {
      details: { nodeId, reason },
      debugMessage:
        reason === 'clientUpgradeRequired'
          ? 'Update OpenCove and reload this window before controlling this agent.'
          : 'Managed Claude restarts are paused. Ask the Worker administrator to enable them.',
    })
  }
}

/** Synchronous ledger lookup immediately before an exact-runtime public kill. */
export function assertManagedClaudeStopAllowed(
  ctx: ControlSurfaceContext,
  store: PersistenceStore,
  sessionId: string,
): void {
  const nodeId = store.managedClaudeNodeIdForRuntime?.(sessionId)
  if (nodeId) {
    assertManagedClaudeMutationAllowed(ctx, nodeId)
  }
}

/** Legacy admission remains fenced across directory and identity awaits without reserving. */
export function guardLegacyManagedClaudeContext(
  ctx: ControlSurfaceContext,
  store: PersistenceStore,
  nodeId: string | null,
  writesEnabled: () => boolean,
): ControlSurfaceContext {
  if (!nodeId) {
    return ctx
  }
  return {
    ...ctx,
    assertActive: () => {
      ctx.assertActive?.()
      const observed = store.observeManagedClaudeNode?.(nodeId)
      if (observed?.retired) {
        throw createAppError('agent.managed_launch_rejected', {
          details: { nodeId, reason: 'nodeGone' },
        })
      }
      if (observed?.binding) {
        assertManagedClaudeMutationAllowed(ctx, nodeId, writesEnabled())
        throw createAppError('agent.managed_launch_rejected', {
          details: { nodeId, reason: 'conflict' },
        })
      }
    },
  }
}
