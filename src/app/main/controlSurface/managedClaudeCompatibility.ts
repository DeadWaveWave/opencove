import type { ControlSurfaceContext } from './types'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createAppError } from '../../../shared/errors/appError'

// @compat managed-claude-bindings-kill-switch
export function managedClaudeWritesEnabled(): boolean {
  return process.env.OPENCOVE_MANAGED_CLAUDE_BINDINGS !== '0'
}
export function assertManagedClaudeMutationAllowed(
  ctx: ControlSurfaceContext,
  nodeId: string,
  enabled = true,
): void {
  const reason = /* @compat managed-claude-worker-support */ !ctx.clientFeatures
    ?.managedClaudeResumeBindingV1
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
          : 'Managed Claude restarts and saving new resume targets are paused. Existing saved targets remain protected. Ask the Worker administrator to enable updates.',
    })
  }
}

/** A snapshot returned across an await cannot authorize an effect on a node's old runtime. */
export function assertNodeRuntimeBindingCurrent(
  store: PersistenceStore,
  targetNodeId: string,
  sessionId: string,
): void {
  if (store.observeManagedClaudeNode) {
    const current = store.observeManagedClaudeNode(targetNodeId)
    if (current.retired || current.nodeRuntimeSessionId !== sessionId) {
      throw createAppError('common.invalid_input', {
        debugMessage:
          'This node now uses a different session. Refresh the node before trying again.',
      })
    }
  }
}

/** Synchronous ledger lookup immediately before an exact-runtime public kill. */
export function assertManagedClaudeStopAllowed(
  ctx: ControlSurfaceContext,
  store: PersistenceStore,
  sessionId: string,
  targetNodeId?: string,
): void {
  if (targetNodeId) {
    assertNodeRuntimeBindingCurrent(store, targetNodeId, sessionId)
  }
  const nodeId = store.managedClaudeNodeIdForRuntime?.(sessionId)
  if (targetNodeId && nodeId && nodeId !== targetNodeId) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Node session changed before stop; read it again.',
    })
  }
  if (nodeId) {
    assertManagedClaudeMutationAllowed(ctx, nodeId)
  }
}

// @compat managed-claude-worker-support
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
