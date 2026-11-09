import type { ControlSurfaceInvokeRequest } from '@shared/contracts/controlSurface'
import type { AttachAgentStateWatcherInput } from '@shared/contracts/dto'
import { canObserveAgentRunState } from '@contexts/workspace/presentation/renderer/utils/agentRuntimeObservation'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import { resolveAgentTreatedProvider } from '@contexts/workspace/presentation/renderer/utils/terminalAgentOverlay'

type ControlSurfaceInvoke = (request: ControlSurfaceInvokeRequest) => Promise<unknown>

interface SessionWatcherOwnership {
  active: AttachAgentStateWatcherInput | null
  desired: AttachAgentStateWatcherInput | null
  reconciling: boolean
  needsReconcile: boolean
}

function watcherKey(input: AttachAgentStateWatcherInput | null): string | null {
  // Identity discovery does not restart a new invocation's file cursor at byte zero.
  return input
    ? JSON.stringify({
        ...input,
        resumeSessionId: input.launchMode === 'new' ? null : input.resumeSessionId,
      })
    : null
}

export function createTerminalAgentWatcherOwner(options: {
  invoke: ControlSurfaceInvoke
  now?: () => number
}): {
  sync: (workspaces: WorkspaceState[]) => void
  dispose: () => void
} {
  const ownershipBySessionId = new Map<string, SessionWatcherOwnership>()
  const now = options.now ?? Date.now
  let disposed = false

  const reconcile = (sessionId: string, ownership: SessionWatcherOwnership): void => {
    if (ownership.reconciling) {
      ownership.needsReconcile = true
      return
    }
    ownership.reconciling = true
    ownership.needsReconcile = false

    void (async () => {
      while (watcherKey(ownership.active) !== watcherKey(ownership.desired)) {
        if (ownership.active) {
          try {
            // eslint-disable-next-line no-await-in-loop -- replacement must wait for disposal
            await options.invoke({
              kind: 'command',
              id: 'session.detachAgentStateWatcher',
              payload: { sessionId },
            })
          } catch {
            break
          }
          ownership.active = null
          continue
        }

        const desired = ownership.desired
        if (!desired || disposed) {
          break
        }

        try {
          // eslint-disable-next-line no-await-in-loop -- ownership transitions are serialized
          await options.invoke({
            kind: 'command',
            id: 'session.attachAgentStateWatcher',
            payload: desired,
          })
          ownership.active = desired
        } catch {
          break
        }
      }
    })().finally(() => {
      ownership.reconciling = false
      if (ownership.needsReconcile) {
        reconcile(sessionId, ownership)
      } else if (!ownership.active && !ownership.desired) {
        ownershipBySessionId.delete(sessionId)
      }
    })
  }

  const sync = (workspaces: WorkspaceState[]): void => {
    if (disposed) {
      return
    }
    const desiredBySessionId = new Map<string, AttachAgentStateWatcherInput>()

    for (const workspace of workspaces) {
      for (const node of workspace.nodes) {
        if (node.data.kind !== 'terminal') {
          continue
        }

        const provider = resolveAgentTreatedProvider(node)
        const sessionId = node.data.sessionId.trim()
        if (!provider || !canObserveAgentRunState(node.data) || sessionId.length === 0) {
          continue
        }

        const binding =
          node.data.terminalAgentBinding?.provider === provider
            ? node.data.terminalAgentBinding
            : null
        const activity = node.data.agentOverlay?.activity
        // Durable bindings are resume affordances, not identity for a new invocation.
        const resumeSessionId = activity?.launchMode
          ? (activity.verifiedProviderSessionId ?? null)
          : (binding?.resumeSessionId ?? null)

        desiredBySessionId.set(sessionId, {
          sessionId,
          provider,
          cwd: node.data.executionDirectory?.trim() || workspace.path,
          launchMode:
            activity?.launchMode ?? (binding?.resumeSessionIdVerified === true ? 'resume' : 'new'),
          resumeSessionId,
          startedAtMs: node.data.agentOverlay?.startedAtMs ?? now(),
        })
      }
    }

    const sessionIds = new Set([...ownershipBySessionId.keys(), ...desiredBySessionId.keys()])
    for (const sessionId of sessionIds) {
      const ownership = ownershipBySessionId.get(sessionId) ?? {
        active: null,
        desired: null,
        reconciling: false,
        needsReconcile: false,
      }
      ownership.desired = desiredBySessionId.get(sessionId) ?? null
      ownershipBySessionId.set(sessionId, ownership)
      reconcile(sessionId, ownership)
    }
  }

  return {
    sync,
    dispose: () => {
      disposed = true
      for (const [sessionId, ownership] of ownershipBySessionId) {
        ownership.desired = null
        reconcile(sessionId, ownership)
      }
    },
  }
}
