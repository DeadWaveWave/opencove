import { createHash } from 'node:crypto'
import type { PluginHostAuthority } from '../../../../contexts/plugins/domain/pluginHostTypes'
import type { PluginObservationType } from '../../../../contexts/plugins/domain/pluginCanvasTypes'
import type { PluginObservationSnapshot } from '../../../../contexts/plugins/application/PluginStateObservations'
import type { PluginInstallationManager } from '../../../../contexts/plugins/application/PluginInstallationManager'
import {
  isReadableNodeKind,
  toCanvasNodeSummary,
} from '../../../../contexts/workspace/application/nodeControl/nodeDtos'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { PtyStreamHub } from '../ptyStream/ptyStreamHub'

export function createPluginCanvasObservationSnapshot(deps: {
  getPersistenceStore(): Promise<PersistenceStore>
  ptyStreamHub: PtyStreamHub
  plugins: PluginInstallationManager
}) {
  return async (
    authority: PluginHostAuthority,
    projectId: string,
    types: PluginObservationType[],
  ): Promise<PluginObservationSnapshot> => {
    const state = normalizePersistedAppState(
      await (await deps.getPersistenceStore()).readAppState(),
    )
    authority.assertActive()
    const project = state?.workspaces.find(item => item.id === projectId)
    const snapshot: PluginObservationSnapshot = new Map()
    const put = (type: PluginObservationType, values: Array<[string, unknown]>) => {
      if (values.length > 10_000) {
        throw new Error('Project exceeds plugin observation entity limit.')
      }
      snapshot.set(
        type,
        new Map(
          values.map(([id, value]) => [
            id,
            createHash('sha256').update(JSON.stringify(value)).digest('hex'),
          ]),
        ),
      )
    }
    const preferences = types.includes('preferences')
      ? await deps.plugins.preferencesGet(authority.pluginId)
      : null
    for (const type of types) {
      if (type === 'project') {
        put(type, project ? [[projectId, { name: project.name, path: project.path }]] : [])
      }
      if (type === 'space') {
        put(type, project?.spaces.map(space => [space.id, space]) ?? [])
      }
      if (type === 'node') {
        put(
          type,
          project?.nodes
            .filter(node => isReadableNodeKind(node.kind))
            .map(node => [
              node.id,
              {
                ...toCanvasNodeSummary({ node, workspace: project }),
                content: node.task,
                collapsed: project.collapsedNodeIds?.includes(node.id) ?? false,
              },
            ]) ?? [],
        )
      }
      if (type === 'session') {
        const sessions = new Map(
          deps.ptyStreamHub.listSessions().sessions.map(item => [item.sessionId, item]),
        )
        put(
          type,
          project?.nodes
            .filter(node => !!node.sessionId)
            .map(node => [
              node.id,
              {
                session: sessions.get(node.sessionId!) ?? null,
                state: deps.ptyStreamHub.observeAgentState(node.sessionId!),
              },
            ]) ?? [],
        )
      }
      if (type === 'preferences') {
        put(type, [[authority.pluginId, preferences]])
      }
    }
    authority.assertActive()
    return snapshot
  }
}
