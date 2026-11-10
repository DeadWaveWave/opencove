import { canvasFocusOperation } from '../../../../shared/contracts/controlSurface/operations/domains/canvas'
import { registerOperation } from '../registerOperation'
import {
  nodeManagedClaudeBindingOperation,
  nodeCreateOperation,
  nodeListOperation,
  nodeGetOperation,
  nodeUpdateOperation,
  nodeDeleteOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/node'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type {
  CanvasFocusResult,
  ListGitWorktreesResult,
  SyncEventPayload,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import {
  createNodeForNodeControl,
  getNodeForNodeControl,
  listNodesForNodeControl,
} from '../../../../contexts/workspace/application/nodeControl/nodeControlUseCases'
import { updateNodeForNodeControl } from '../../../../contexts/workspace/application/nodeControl/nodeControlUpdate'
import { deleteNodeForNodeControl } from '../../../../contexts/workspace/application/nodeControl/nodeControlDelete'
import { resolveCanvasFocusTargetForNodeControl } from '../../../../contexts/workspace/application/nodeControl/nodeControlFocus'
import type { SpaceLocatorResolverDeps } from '../../../../contexts/workspace/application/nodeControl/spaceLocator'
import type { NodeControlAppStateStore } from '../../../../contexts/workspace/application/nodeControl/nodeControlState'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import { createRuntimeDeps } from './nodeControlRuntime'

async function invokeInternal<TResult>(
  controlSurface: ControlSurface,
  ctx: ControlSurfaceContext,
  request: { kind: 'query' | 'command'; id: string; payload: unknown },
): Promise<TResult> {
  const result = await controlSurface.invoke(ctx, request)
  if (!result.ok) {
    throw createAppError(result.error)
  }
  return result.value as TResult
}

function createLocatorDeps(
  controlSurface: ControlSurface,
  topology: WorkerTopologyStore,
  ctx: ControlSurfaceContext,
): SpaceLocatorResolverDeps {
  return {
    listEndpoints: async () => (await topology.listEndpoints()).endpoints,
    listMounts: async projectId => (await topology.listMounts({ projectId })).mounts,
    listWorktreesForMount: async mountId =>
      (
        await invokeInternal<ListGitWorktreesResult>(controlSurface, ctx, {
          kind: 'query',
          id: 'gitWorktree.listWorktreesInMount',
          payload: { mountId },
        })
      ).worktrees,
    listWorktreesForWorkspace: async workspace =>
      (
        await invokeInternal<ListGitWorktreesResult>(controlSurface, ctx, {
          kind: 'query',
          id: 'gitWorktree.listWorktrees',
          payload: { repoPath: workspace.path },
        })
      ).worktrees,
  }
}

function toNodeControlStateStore(store: PersistenceStore): NodeControlAppStateStore {
  return {
    readAppState: async () => normalizePersistedAppState(await store.readAppState()),
    readAppStateRevision: store.readAppStateRevision,
    writeAppState: store.writeAppState,
    isRuntimeReferenced: store.isManagedClaudeRuntimeReferenced,
    isManagedNode: store.observeManagedClaudeNode
      ? id => Boolean(store.observeManagedClaudeNode!(id).binding)
      : undefined,
  }
}

function queued<T>(queueRef: { current: Promise<void> }, task: () => Promise<T>): Promise<T> {
  const next = queueRef.current.then(task, task)
  queueRef.current = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export function registerNodeControlHandlers(
  controlSurface: ControlSurface,
  deps: {
    topology: WorkerTopologyStore
    getPersistenceStore: () => Promise<PersistenceStore>
    publishSyncEvent?: (payload: SyncEventPayload) => number
    closePluginNode?: (nodeId: string) => Promise<void> | void
    closeWebsiteNode?: (nodeId: string) => Promise<void> | void
  },
): void {
  const mutationQueue = { current: Promise.resolve() }
  const withDeps = async (ctx: ControlSurfaceContext) => ({
    store: toNodeControlStateStore(await deps.getPersistenceStore()),
    locatorDeps: createLocatorDeps(controlSurface, deps.topology, ctx),
    runtime: createRuntimeDeps(controlSurface, ctx, deps.closeWebsiteNode, deps.closePluginNode),
  })

  registerOperation(controlSurface, nodeManagedClaudeBindingOperation, {
    defaultErrorCode: 'persistence.unavailable',
    handle: async (_ctx, input) => {
      const store = await deps.getPersistenceStore()
      if (!store.observeManagedClaudeNode) {
        throw createAppError('persistence.unavailable')
      }
      const observed = store.observeManagedClaudeNode(input.nodeId)
      return {
        managedClaudeBinding: observed.binding,
        retired: observed.retired,
        executionDirectory: observed.context?.directory ?? null,
      }
    },
  })
  registerOperation(controlSurface, nodeListOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (ctx, input) => {
      const { store, locatorDeps } = await withDeps(ctx)
      return await listNodesForNodeControl({ store, locatorDeps, input })
    },
  })
  registerOperation(controlSurface, nodeGetOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (_ctx, input) => {
      const store = await deps.getPersistenceStore()
      const result = await getNodeForNodeControl({ store: toNodeControlStateStore(store), input })
      const binding = store.observeManagedClaudeNode?.(input.nodeId).binding
      return { ...result, ...(binding ? { managedClaudeBinding: binding } : {}) }
    },
  })
  registerOperation(controlSurface, nodeCreateOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (ctx, input) =>
      queued(mutationQueue, async () => {
        const { store, locatorDeps, runtime } = await withDeps(ctx)
        return await createNodeForNodeControl({
          store,
          locatorDeps,
          runtime,
          input,
          now: ctx.now(),
          callerNodeId:
            ctx.requestAuth?.kind === 'session-grant' ? ctx.requestAuth.grant.nodeId : null,
        })
      }),
  })
  registerOperation(controlSurface, nodeUpdateOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (ctx, input) =>
      queued(
        mutationQueue,
        async () =>
          await updateNodeForNodeControl({
            store: toNodeControlStateStore(await deps.getPersistenceStore()),
            input,
            assertActive: ctx.assertActive,
          }),
      ),
  })
  registerOperation(controlSurface, nodeDeleteOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (ctx, input) =>
      queued(mutationQueue, async () => {
        const runtime = createRuntimeDeps(
          controlSurface,
          ctx,
          deps.closeWebsiteNode,
          deps.closePluginNode,
        )
        return await deleteNodeForNodeControl({
          store: toNodeControlStateStore(await deps.getPersistenceStore()),
          runtime,
          input,
          now: ctx.now(),
          assertActive: ctx.assertActive,
        })
      }),
  })
  registerOperation(controlSurface, canvasFocusOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (ctx, input) => {
      const persistenceStore = await deps.getPersistenceStore()
      const store = toNodeControlStateStore(persistenceStore)
      const locatorDeps = createLocatorDeps(controlSurface, deps.topology, ctx)
      const resolved = await resolveCanvasFocusTargetForNodeControl({
        store,
        locatorDeps,
        target: input.target,
      })
      const payload: SyncEventPayload = {
        type: 'canvas.focus',
        revision: await persistenceStore.readAppStateRevision(),
        projectId: resolved.projectId,
        target: resolved.target,
        createdAt: ctx.now().toISOString(),
      }
      ctx.assertActive?.()
      const deliveredClientCount = deps.publishSyncEvent?.(payload) ?? 0
      return {
        projectId: resolved.projectId,
        target: resolved.target,
        deliveredClientCount,
        delivered: deliveredClientCount > 0,
      } satisfies CanvasFocusResult
    },
  })
}
