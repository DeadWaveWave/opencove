import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type {
  CanvasFocusInput,
  CanvasFocusResult,
  CreateNodeInput,
  DeleteNodeInput,
  GetNodeInput,
  ListGitWorktreesResult,
  ListNodesInput,
  ManagedCanvasNodeKind,
  SyncEventPayload,
  UpdateNodeInput,
  UpdatableCanvasNodeKind,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { ControlSurfaceHandler } from '../types'
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
import { normalizeSpaceLocator } from './nodeControlHandlerInput'
import { createRuntimeDeps } from './nodeControlRuntime'
import { isReadableNodeKind } from '../../../../contexts/workspace/application/nodeControl/nodeDtos'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredString(value: unknown, debugName: string): string {
  const normalized = optionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}.` })
  }
  return normalized
}

function managedKind(value: unknown): ManagedCanvasNodeKind {
  if (
    value === 'note' ||
    value === 'task' ||
    value === 'website' ||
    value === 'agent' ||
    value === 'terminal'
  ) {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid node kind.' })
}

function updatableKind(value: unknown): UpdatableCanvasNodeKind {
  if (value === 'note' || value === 'task' || value === 'website') {
    return value
  }
  if (value === 'agent' || value === 'terminal') {
    throw createAppError('node.unsupported_operation')
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid node update kind.' })
}

function normalizeFrame(value: unknown): CreateNodeInput['frame'] {
  if (value === null || value === undefined) {
    return null
  }
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid node frame.' })
  }
  const result: NonNullable<CreateNodeInput['frame']> = {}
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (value[key] === null || value[key] === undefined) {
      continue
    }
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      throw createAppError('common.invalid_input', { debugMessage: `Invalid frame.${key}.` })
    }
    result[key] = value[key]
  }
  return result
}

function normalizeListPayload(payload: unknown): ListNodesInput {
  if (payload === null || payload === undefined) {
    return {}
  }
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid payload for node.list.' })
  }
  return {
    space:
      payload.space === null || payload.space === undefined
        ? null
        : normalizeSpaceLocator(payload.space),
    projectId: optionalString(payload.projectId),
    kind:
      payload.kind === null || payload.kind === undefined
        ? null
        : isReadableNodeKind(payload.kind)
          ? payload.kind
          : managedKind(payload.kind),
  }
}

function normalizeGetPayload(payload: unknown): GetNodeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid payload for node.get.' })
  }
  return { nodeId: requiredString(payload.nodeId, 'nodeId') }
}

function normalizeCreatePayload(payload: unknown): CreateNodeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for node.create.',
    })
  }
  return {
    kind: managedKind(payload.kind),
    space:
      payload.space === null || payload.space === undefined
        ? null
        : normalizeSpaceLocator(payload.space),
    projectId: optionalString(payload.projectId),
    title: optionalString(payload.title),
    frame: normalizeFrame(payload.frame),
    data: payload.data ?? null,
  }
}

function normalizeUpdatePayload(payload: unknown): UpdateNodeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for node.update.',
    })
  }
  return {
    kind: updatableKind(payload.kind),
    nodeId: requiredString(payload.nodeId, 'nodeId'),
    title: optionalString(payload.title),
    frame: normalizeFrame(payload.frame),
    data: payload.data ?? null,
  }
}

function normalizeDeletePayload(payload: unknown): DeleteNodeInput {
  return { nodeId: requiredString(isRecord(payload) ? payload.nodeId : null, 'nodeId') }
}

function normalizeFocusPayload(payload: unknown): CanvasFocusInput {
  if (!isRecord(payload) || !isRecord(payload.target)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for canvas.focus.',
    })
  }
  if (payload.target.kind === 'node') {
    return {
      target: { kind: 'node', nodeId: requiredString(payload.target.nodeId, 'nodeId') },
    }
  }
  if (payload.target.kind === 'space') {
    return { target: { kind: 'space', locator: normalizeSpaceLocator(payload.target.locator) } }
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid focus target.' })
}

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

  controlSurface.register(
    'node.list',
    query(normalizeListPayload, async (ctx, input) => {
      const { store, locatorDeps } = await withDeps(ctx)
      return await listNodesForNodeControl({ store, locatorDeps, input })
    }),
  )
  controlSurface.register(
    'node.get',
    query(normalizeGetPayload, async (_ctx, input) => {
      return await getNodeForNodeControl({
        store: toNodeControlStateStore(await deps.getPersistenceStore()),
        input,
      })
    }),
  )
  controlSurface.register(
    'node.create',
    command(normalizeCreatePayload, async (ctx, input) =>
      queued(mutationQueue, async () => {
        const { store, locatorDeps, runtime } = await withDeps(ctx)
        return await createNodeForNodeControl({
          store,
          locatorDeps,
          runtime,
          input,
          now: ctx.now(),
        })
      }),
    ),
  )
  controlSurface.register(
    'node.update',
    command(normalizeUpdatePayload, async (ctx, input) =>
      queued(
        mutationQueue,
        async () =>
          await updateNodeForNodeControl({
            store: toNodeControlStateStore(await deps.getPersistenceStore()),
            input,
            assertActive: ctx.assertActive,
          }),
      ),
    ),
  )
  controlSurface.register(
    'node.delete',
    command(normalizeDeletePayload, async (ctx, input) =>
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
    ),
  )
  controlSurface.register(
    'canvas.focus',
    command(normalizeFocusPayload, async (ctx, input) => {
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
    }),
  )
}

function query<TPayload, TResult>(
  validate: (payload: unknown) => TPayload,
  handle: ControlSurfaceHandler<TPayload, TResult>['handle'],
): ControlSurfaceHandler<TPayload, TResult> {
  return { kind: 'query', validate, handle, defaultErrorCode: 'common.unexpected' }
}

function command<TPayload, TResult>(
  validate: (payload: unknown) => TPayload,
  handle: ControlSurfaceHandler<TPayload, TResult>['handle'],
): ControlSurfaceHandler<TPayload, TResult> {
  return { kind: 'command', validate, handle, defaultErrorCode: 'common.unexpected' }
}
