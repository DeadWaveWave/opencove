import { randomUUID } from 'node:crypto'
import type { PluginInstallationManager } from '../../../../contexts/plugins/application/PluginInstallationManager'
import { PluginStateObservations } from '../../../../contexts/plugins/application/PluginStateObservations'
import type {
  PluginHostAuthority,
  PluginResolvedTarget,
} from '../../../../contexts/plugins/domain/pluginHostTypes'
import type {
  PluginObservationType,
  PluginSessionState,
} from '../../../../contexts/plugins/domain/pluginCanvasTypes'
import {
  pluginRecord,
  pluginString,
} from '../../../../contexts/plugins/domain/localPluginValidation'
import { pluginJsonValue } from '../../../../contexts/plugins/domain/pluginJsonValue'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type {
  GetNodeResult,
  ListNodesResult,
  GetSessionSnapshotResult,
  ListSessionsResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { listPluginTargets, pluginTargetInput, resolvePluginTarget } from './pluginTargetResolution'
import { createPluginCanvasObservationSnapshot } from './pluginCanvasObservations'

function fields(value: unknown, allowed: readonly string[]) {
  const input = pluginRecord(value)
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    throw new Error('Unsupported plugin canvas argument.')
  }
  return input
}
const observationTypes = ['project', 'space', 'node', 'session', 'preferences'] as const

export function createPluginCanvasHost(
  control: ControlSurface,
  deps: {
    plugins: PluginInstallationManager
    getPersistenceStore(): Promise<PersistenceStore>
    topology: WorkerTopologyStore
    ptyStreamHub: PtyStreamHub
    context: ControlSurfaceContext
  },
) {
  const observations = new PluginStateObservations(
    createPluginCanvasObservationSnapshot(deps),
    randomUUID,
  )
  async function invoke<T>(
    authority: PluginHostAuthority,
    id: string,
    kind: 'query' | 'command',
    payload: unknown,
    target?: PluginResolvedTarget,
  ): Promise<T> {
    authority.assertActive()
    const ctx: ControlSurfaceContext = {
      ...deps.context,
      assertActive: authority.assertActive,
      ...(target
        ? {
            validateNodeTarget: async (
              resolved: Parameters<NonNullable<ControlSurfaceContext['validateNodeTarget']>>[0],
            ) => {
              const current = await resolvePluginTarget(
                {
                  projectId: target.projectId,
                  ...(target.spaceId ? { spaceId: target.spaceId } : {}),
                },
                deps,
              )
              authority.assertActive()
              if (
                JSON.stringify(current) !== JSON.stringify(target) ||
                resolved.workspace.id !== target.projectId ||
                (resolved.space?.id ?? null) !== target.spaceId ||
                resolved.mount?.mountId !== target.mountId ||
                resolved.mount.endpointId !== target.endpointId ||
                (resolved.mount.rootUri !== target.rootUri && !target.spaceId) ||
                resolved.workingDirectory !== target.workingDirectory
              ) {
                throw new Error('Node execution target changed before creation; resolve it again.')
              }
            },
          }
        : {}),
    }
    const result = await control.invoke(ctx, { id, kind, payload })
    if (!result.ok) {
      throw new Error(result.error.debugMessage ?? createAppError(result.error).message)
    }
    authority.assertActive()
    return result.value as T
  }
  async function project(authority: PluginHostAuthority, projectId: string, spaceId?: string) {
    const item = (await listPluginTargets(deps)).projects.find(value => value.id === projectId)
    authority.assertActive()
    if (!item || (spaceId && !item.spaces.some(space => space.id === spaceId))) {
      throw new Error('Project or Space is unavailable.')
    }
  }
  async function node(authority: PluginHostAuthority, nodeId: string) {
    return (await invoke<GetNodeResult>(authority, 'node.get', 'query', { nodeId })).node
  }
  async function session(
    authority: PluginHostAuthority,
    nodeId: string,
    kind: 'terminal' | 'agent',
  ): Promise<PluginSessionState> {
    const item = await node(authority, nodeId)
    if (item.kind !== kind) {
      throw new Error(`Expected ${kind === 'agent' ? 'an agent' : 'a terminal'} node.`)
    }
    const sessions = await invoke<ListSessionsResult>(authority, 'session.list', 'query', {})
    const current = sessions.sessions.find(value => value.sessionId === item.sessionId) ?? null
    return {
      node: item,
      session: current,
      agentState: current ? deps.ptyStreamHub.observeAgentState(current.sessionId) : null,
    }
  }
  async function create(
    authority: PluginHostAuthority,
    input: Record<string, unknown>,
    kind: unknown,
    data: unknown,
  ) {
    const target = await resolvePluginTarget(pluginTargetInput(input.target), deps)
    authority.assertActive()
    return invoke(
      authority,
      'node.create',
      'command',
      {
        projectId: target.projectId,
        space: target.spaceId ? { kind: 'spaceId', spaceId: target.spaceId } : null,
        kind,
        title: input.title,
        frame: input.frame,
        data,
      },
      target,
    )
  }
  async function request(
    authority: PluginHostAuthority,
    operation: string,
    payload: unknown,
  ): Promise<unknown> {
    authority.assertActive()
    if (operation === 'events.subscribe') {
      const input = fields(payload, ['projectId', 'types'])
      const projectId = pluginString(input.projectId, 'projectId', 200)
      const types = input.types ?? [...observationTypes]
      if (
        !Array.isArray(types) ||
        !types.length ||
        types.length > observationTypes.length ||
        types.some(value => !observationTypes.includes(value))
      ) {
        throw new Error('Invalid plugin observation types.')
      }
      await project(authority, projectId)
      return observations.subscribe(authority, projectId, [
        ...new Set(types),
      ] as PluginObservationType[])
    }
    if (operation === 'events.poll' || operation === 'events.dispose') {
      const input = fields(payload, ['subscriptionId'])
      const id = pluginString(input.subscriptionId, 'subscriptionId', 100)
      return operation === 'events.poll'
        ? observations.poll(authority, id)
        : observations.dispose(authority, id)
    }
    if (operation === 'nodes.list') {
      const input = fields(payload, ['projectId', 'spaceId', 'kind'])
      const target = pluginTargetInput({
        projectId: input.projectId,
        ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      })
      await project(authority, target.projectId, target.spaceId)
      const result = await invoke<ListNodesResult>(authority, 'node.list', 'query', {
        projectId: target.projectId,
        space: target.spaceId ? { kind: 'spaceId', spaceId: target.spaceId } : null,
        kind: input.kind,
      })
      return pluginJsonValue(
        { ...result, nodes: result.nodes.slice(0, 1000), truncated: result.nodes.length > 1000 },
        1024 * 1024,
        'node list',
      )
    }
    if (operation === 'nodes.create') {
      const input = fields(payload, ['target', 'kind', 'title', 'frame', 'data'])
      return create(authority, input, input.kind, input.data)
    }
    if (operation === 'terminals.create' || operation === 'agents.launch') {
      const terminal = operation === 'terminals.create'
      const input = fields(
        payload,
        terminal
          ? ['target', 'title', 'frame', 'profileId', 'shell', 'command']
          : ['target', 'title', 'frame', 'prompt', 'provider', 'model'],
      )
      return create(
        authority,
        input,
        terminal ? 'terminal' : 'agent',
        terminal
          ? { profileId: input.profileId, shell: input.shell, command: input.command }
          : { prompt: input.prompt, provider: input.provider, model: input.model },
      )
    }
    if (operation === 'nodes.update') {
      const input = fields(payload, ['nodeId', 'kind', 'title', 'frame', 'data'])
      return invoke(authority, 'node.update', 'command', {
        ...input,
        nodeId: pluginString(input.nodeId, 'nodeId', 200),
      })
    }
    const input = fields(payload, operation.endsWith('.write') ? ['nodeId', 'data'] : ['nodeId'])
    const nodeId = pluginString(input.nodeId, 'nodeId', 200)
    if (operation === 'nodes.get') {
      return { node: await node(authority, nodeId) }
    }
    if (operation === 'nodes.focus') {
      return invoke(authority, 'canvas.focus', 'command', { target: { kind: 'node', nodeId } })
    }
    if (operation === 'nodes.close') {
      return invoke(authority, 'node.delete', 'command', { nodeId })
    }
    const [group, action] = operation.split('.')
    if (
      !['terminals', 'agents'].includes(group) ||
      !['get', 'read', 'write', 'interrupt', 'stop'].includes(action)
    ) {
      throw new Error('Unsupported plugin canvas operation.')
    }
    const current = await session(authority, nodeId, group === 'terminals' ? 'terminal' : 'agent')
    if (action === 'get') {
      return current
    }
    if (!current.session || (current.session.status !== 'running' && action !== 'read')) {
      throw new Error('Node session is not running; no replacement was launched.')
    }
    const sessionId = current.session.sessionId
    if (action === 'read') {
      const snapshot = await invoke<GetSessionSnapshotResult>(
        authority,
        'session.snapshot',
        'query',
        { sessionId },
      )
      const data = new TextEncoder().encode(snapshot.scrollback)
      let start = Math.max(0, data.length - 256 * 1024)
      while (start < data.length && (data[start] & 0xc0) === 0x80) {
        start += 1
      }
      return {
        nodeId,
        sessionId,
        output: new TextDecoder().decode(data.slice(start)),
        truncated: snapshot.truncated || data.length > 256 * 1024,
        fromSeq: snapshot.fromSeq,
        toSeq: snapshot.toSeq,
      }
    }
    if (action === 'stop') {
      return invoke(authority, 'session.stopNode', 'command', { nodeId, sessionId })
    }
    if (action === 'write' && typeof input.data !== 'string') {
      throw new Error('Terminal input requires a string.')
    }
    return invoke(authority, 'session.writeNode', 'command', {
      nodeId,
      sessionId,
      data: action === 'interrupt' ? '\u0003' : input.data,
    })
  }
  return {
    handles: (operation: string) => /^(nodes|terminals|agents|events)\./.test(operation),
    request,
    retire: (ownerId: string) => observations.retire(ownerId),
  }
}
