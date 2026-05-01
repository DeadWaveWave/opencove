import process from 'node:process'
import { basename } from 'node:path'
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
  SpaceLocator,
  SpawnTerminalInMountInput,
  SpawnTerminalInput,
  SpawnTerminalResult,
  SyncEventPayload,
  UpdateNodeInput,
  UpdatableCanvasNodeKind,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { toFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { ControlSurfaceHandler } from '../types'
import { resolveDefaultShell } from '../../../../platform/process/pty/defaultShell'
import {
  createNodeForNodeControl,
  getNodeForNodeControl,
  listNodesForNodeControl,
  type NodeControlRuntimeDeps,
} from '../../../../contexts/workspace/application/nodeControl/nodeControlUseCases'
import { updateNodeForNodeControl } from '../../../../contexts/workspace/application/nodeControl/nodeControlUpdate'
import { deleteNodeForNodeControl } from '../../../../contexts/workspace/application/nodeControl/nodeControlDelete'
import { resolveCanvasFocusTargetForNodeControl } from '../../../../contexts/workspace/application/nodeControl/nodeControlFocus'
import type { SpaceLocatorResolverDeps } from '../../../../contexts/workspace/application/nodeControl/spaceLocator'
import type { NodeControlAppStateStore } from '../../../../contexts/workspace/application/nodeControl/nodeControlState'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import {
  managedAgentProvider,
  managedTerminalRuntimeKind,
} from './nodeControlHandlerRuntimeMetadata'

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

function normalizeSpaceLocator(value: unknown): SpaceLocator {
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid space locator.' })
  }
  if (value.kind === 'spaceId') {
    return { kind: 'spaceId', spaceId: requiredString(value.spaceId, 'spaceId') }
  }
  if (value.kind === 'spaceName') {
    return {
      kind: 'spaceName',
      name: requiredString(value.name, 'spaceName'),
      projectId: optionalString(value.projectId),
    }
  }
  if (value.kind === 'workerBranch') {
    return {
      kind: 'workerBranch',
      worker: requiredString(value.worker, 'worker'),
      branch: requiredString(value.branch, 'branch'),
      projectId: optionalString(value.projectId),
    }
  }
  if (value.kind === 'workerPath') {
    return {
      kind: 'workerPath',
      worker: requiredString(value.worker, 'worker'),
      path: requiredString(value.path, 'path'),
      projectId: optionalString(value.projectId),
    }
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid space locator kind.' })
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
    kind: payload.kind === null || payload.kind === undefined ? null : managedKind(payload.kind),
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
    space: normalizeSpaceLocator(payload.space),
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

function resolveTerminalCommand(data: { shell: string | null; command: string | null }): {
  shell: string | null
  command: string | null
  args: string[] | null
} {
  if (!data.command) {
    return { shell: data.shell, command: null, args: null }
  }
  const shell = data.shell ?? resolveDefaultShell()
  if (process.platform === 'win32') {
    const name = basename(shell).toLowerCase()
    if (name.includes('cmd')) {
      return { shell: null, command: shell, args: ['/d', '/s', '/c', data.command] }
    }
    if (name.includes('powershell') || name.includes('pwsh')) {
      return { shell: null, command: shell, args: ['-NoLogo', '-Command', data.command] }
    }

    return { shell: null, command: shell, args: ['-lc', data.command] }
  }
  return { shell: null, command: shell, args: ['-lc', data.command] }
}

function createRuntimeDeps(
  controlSurface: ControlSurface,
  ctx: ControlSurfaceContext,
  closeWebsiteNode: ((nodeId: string) => Promise<void> | void) | undefined,
): NodeControlRuntimeDeps {
  return {
    launchAgent: async (resolved, data) => {
      const payload = resolved.mount
        ? {
            mountId: resolved.mount.mountId,
            cwdUri: toFileUri(resolved.workingDirectory),
            prompt: data.prompt,
            provider: data.provider,
            model: data.model,
          }
        : {
            spaceId: resolved.space.id,
            prompt: data.prompt,
            provider: data.provider,
            model: data.model,
          }
      const launched = await invokeInternal<Record<string, unknown>>(controlSurface, ctx, {
        kind: 'command',
        id: resolved.mount ? 'session.launchAgentInMount' : 'session.launchAgent',
        payload,
      })
      const executionContext = isRecord(launched.executionContext) ? launched.executionContext : {}
      return {
        sessionId: requiredString(launched.sessionId, 'sessionId'),
        provider: managedAgentProvider(launched.provider),
        prompt: data.prompt,
        model: data.model,
        effectiveModel: optionalString(launched.effectiveModel),
        executionDirectory:
          optionalString(executionContext.workingDirectory) ?? resolved.workingDirectory,
        expectedDirectory: resolved.workingDirectory,
        startedAt: optionalString(launched.startedAt) ?? ctx.now().toISOString(),
        profileId: launched.profileId === null ? null : optionalString(launched.profileId),
        runtimeKind: managedTerminalRuntimeKind(launched.runtimeKind),
      }
    },
    spawnTerminal: async (resolved, data) => {
      const terminalCommand = resolveTerminalCommand(data)
      const base = {
        profileId: data.profileId ?? undefined,
        shell: terminalCommand.shell ?? undefined,
        command: terminalCommand.command ?? undefined,
        args: terminalCommand.args ?? undefined,
        cols: 80,
        rows: 24,
      }
      const result = resolved.mount
        ? await invokeInternal<SpawnTerminalResult>(controlSurface, ctx, {
            kind: 'command',
            id: 'pty.spawnInMount',
            payload: {
              mountId: resolved.mount.mountId,
              cwdUri: toFileUri(resolved.workingDirectory),
              ...base,
            } satisfies SpawnTerminalInMountInput,
          })
        : await invokeInternal<SpawnTerminalResult>(controlSurface, ctx, {
            kind: 'command',
            id: 'pty.spawn',
            payload: {
              cwd: resolved.workingDirectory,
              ...base,
            } satisfies SpawnTerminalInput,
          })
      return {
        sessionId: result.sessionId,
        executionDirectory: resolved.workingDirectory,
        expectedDirectory: resolved.workingDirectory,
        startedAt: ctx.now().toISOString(),
        profileId: result.profileId ?? data.profileId,
        runtimeKind: result.runtimeKind ?? null,
      }
    },
    killSession: async sessionId => {
      await invokeInternal<void>(controlSurface, ctx, {
        kind: 'command',
        id: 'session.kill',
        payload: { sessionId },
      })
    },
    closeWebsiteNode,
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
    closeWebsiteNode?: (nodeId: string) => Promise<void> | void
  },
): void {
  const mutationQueue = { current: Promise.resolve() }
  const withDeps = async (ctx: ControlSurfaceContext) => ({
    store: toNodeControlStateStore(await deps.getPersistenceStore()),
    locatorDeps: createLocatorDeps(controlSurface, deps.topology, ctx),
    runtime: createRuntimeDeps(controlSurface, ctx, deps.closeWebsiteNode),
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
    command(normalizeUpdatePayload, async (_ctx, input) =>
      queued(
        mutationQueue,
        async () =>
          await updateNodeForNodeControl({
            store: toNodeControlStateStore(await deps.getPersistenceStore()),
            input,
          }),
      ),
    ),
  )
  controlSurface.register(
    'node.delete',
    command(normalizeDeletePayload, async (ctx, input) =>
      queued(mutationQueue, async () => {
        const runtime = createRuntimeDeps(controlSurface, ctx, deps.closeWebsiteNode)
        return await deleteNodeForNodeControl({
          store: toNodeControlStateStore(await deps.getPersistenceStore()),
          runtime,
          input,
          now: ctx.now(),
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
