import { createAppError } from '../../../../shared/errors/appError'
import type { TopologyState } from './topologyPersistence'

export interface TopologyPersistenceIssue {
  operation: string
  failedAt: string
  pendingCount: number
}

export type TopologyMutation<T> = {
  operation: string
  apply: (draft: TopologyState) => Promise<T> | T
}

type FailedTopologyMutation = {
  operation: string
  failedAt: string
  apply: TopologyMutation<unknown>['apply']
}

function cloneTopologyState(state: TopologyState): TopologyState {
  return {
    topology: {
      version: 1,
      endpoints: state.topology.endpoints.map(endpoint => ({
        ...endpoint,
        managedSsh: endpoint.managedSsh ? { ...endpoint.managedSsh } : null,
      })),
      mounts: state.topology.mounts.map(mount => ({ ...mount })),
    },
    secrets: {
      version: 1,
      tokensByCredentialRef: { ...state.secrets.tokensByCredentialRef },
    },
  }
}

export interface TopologyMutationQueue {
  enqueue: <T>(mutation: TopologyMutation<T>) => Promise<T>
  getPersistenceIssue: () => TopologyPersistenceIssue | null
  retryPersistence: () => Promise<void>
}

export function createTopologyMutationQueue(options: {
  getCommittedState: () => TopologyState
  replaceCommittedState: (state: TopologyState) => void
  readDurableState: () => Promise<TopologyState>
  persist: (draft: TopologyState) => Promise<void>
}): TopologyMutationQueue {
  let queueTail: Promise<void> = Promise.resolve()
  const failedMutations: FailedTopologyMutation[] = []

  /**
   * Durable topology files are authoritative. Mutations execute in FIFO order against a draft of
   * the latest committed state. Success commits that draft; failure reloads the files so memory
   * never stays ahead of durable fact. The operation stays rejected for its caller, while the
   * queue tail is recovered for later writes and retry remains explicit.
   */
  const enqueue = async <T>(
    mutation: TopologyMutation<T>,
    enqueueOptions: { recordFailure?: boolean } = {},
  ): Promise<T> => {
    const operation = queueTail.then(async () => {
      const draft = cloneTopologyState(options.getCommittedState())
      const result = await mutation.apply(draft)

      try {
        await options.persist(draft)
      } catch (error) {
        options.replaceCommittedState(await options.readDurableState())

        if (enqueueOptions.recordFailure !== false) {
          failedMutations.push({
            operation: mutation.operation,
            failedAt: new Date().toISOString(),
            apply: mutation.apply as TopologyMutation<unknown>['apply'],
          })
        }

        throw createAppError('persistence.io_failed', {
          debugMessage: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        })
      }

      options.replaceCommittedState(draft)
      return result
    })

    queueTail = operation.then(
      () => undefined,
      () => undefined,
    )
    return await operation
  }

  return {
    enqueue,
    getPersistenceIssue: () => {
      const issue = failedMutations[0]
      return issue
        ? {
            operation: issue.operation,
            failedAt: issue.failedAt,
            pendingCount: failedMutations.length,
          }
        : null
    },
    retryPersistence: async () => {
      const issue = failedMutations[0]
      if (!issue) {
        return
      }

      await enqueue({ operation: issue.operation, apply: issue.apply }, { recordFailure: false })
      if (failedMutations[0] === issue) {
        failedMutations.shift()
      }
    },
  }
}
