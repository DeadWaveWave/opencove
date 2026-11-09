import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import { mergePersistedAppStates } from '../../../src/shared/sync/mergePersistedAppStates'
import { normalizePersistedAppStateForMerge } from '../../../src/shared/sync/normalizePersistedAppStateForMerge'
import { updateNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUpdate'
import { getNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases'
import type { NodeControlAppStateStore } from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { applyAgentSessionTitleToNodes } from '../../../src/contexts/workspace/presentation/renderer/utils/agentSessionTitleSync'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { toRuntimeNodes } from '../../../src/contexts/workspace/presentation/renderer/utils/nodeTransform'
import { toPersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import {
  guardNodeFromSyncOverwrite,
  isNodeGuardedFromSyncOverwrite,
} from '../../../src/contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { toShellWorkspaceStateForSync } from '../../../src/app/renderer/shell/hooks/workerSync/mergeWorkspaceStateForSync'
import { publishSharedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/reconcilePublication'
import type { PersistencePort } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/port'
import { createMinimalState } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

function fixture() {
  const id = randomUUID()
  const raw = createMinimalState('/repo', 'project', 'space')
  raw.settings = DEFAULT_AGENT_SETTINGS
  raw.workspaces[0].nodes = [
    {
      id,
      kind: 'agent',
      sessionId: 'runtime',
      title: 'codex',
      titlePinnedByUser: false,
      titleIsLiteral: false,
      position: { x: 0, y: 0 },
      width: 520,
      height: 360,
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      task: null,
      scrollback: null,
      labelColorOverride: null,
      agent: {
        provider: 'codex',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: 'resume',
        resumeSessionIdVerified: true,
        executionDirectory: '/repo',
        expectedDirectory: '/repo',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
    },
  ]
  raw.workspaces[0].spaces[0].nodeIds = [id]
  const ancestor = normalizePersistedAppStateForMerge(raw, normalizeAgentSettings)!
  let durable = structuredClone(ancestor),
    revision = 1
  const store: NodeControlAppStateStore = {
    readAppState: async () => durable,
    readAppStateRevision: async () => revision,
    writeAppState: async (state, options) => {
      expect(options?.expectedRevision).toBe(revision)
      durable = normalizePersistedAppStateForMerge(state, normalizeAgentSettings)!
      return { ok: true, level: 'full', bytes: 1, revision: ++revision }
    },
  }
  const workspace = ensurePersistedWorkspace(ancestor.workspaces[0])!
  const target = {
    nodeId: id,
    runtimeSessionId: 'runtime',
    resumeSessionId: 'resume',
    provider: 'codex' as const,
  }
  const changed = applyAgentSessionTitleToNodes(
    toRuntimeNodes(workspace),
    target,
    'Late session title',
  )
  expect(changed.didChange).toBe(true)
  const localWorkspace = { ...workspace, nodes: changed.nextNodes }
  localWorkspace.nodes[0].position = { x: 42, y: 0 }
  const local = normalizePersistedAppStateForMerge(
    toPersistedState([localWorkspace], 'project'),
    normalizeAgentSettings,
  )!
  const write = vi.fn(async (state: unknown, options?: { baseRevision?: number | null }) => {
    expect(options?.baseRevision).toBe(revision)
    return await store.writeAppState(
      state as Parameters<NodeControlAppStateStore['writeAppState']>[0],
      { expectedRevision: revision },
    )
  })
  const port = {
    kind: 'ipc',
    readAppState: async () => ({ state: durable, revision, recovery: null }),
    writeAppState: write,
  } as PersistencePort
  return { id, ancestor, local, localWorkspace, store, port, write, target, latest: () => durable }
}

it('keeps a real concurrent CLI rename through pending renderer auto-title publication', async () => {
  const f = fixture()
  await updateNodeForNodeControl({
    store: f.store,
    input: { kind: 'agent', nodeId: f.id, title: 'Lead' },
  })
  expect(
    await publishSharedState(f.port, f.local, JSON.stringify(f.ancestor), { baseRevision: 1 }),
  ).toMatchObject({ ok: true, merged: true })
  expect(f.write).toHaveBeenCalledOnce()
  expect(f.latest().workspaces[0].nodes[0]).toMatchObject({
    title: 'Lead',
    titlePinnedByUser: true,
    titleIsLiteral: true,
    position: { x: 42, y: 0 },
  })
  expect(
    (await getNodeForNodeControl({ store: f.store, input: { nodeId: f.id } })).node.title,
  ).toBe('Lead')
})

it.each([true, false])(
  'rebases guarded deltas without replacing a pin (accepted base=%s)',
  async withBase => {
    const f = fixture()
    await updateNodeForNodeControl({
      store: f.store,
      input: { kind: 'agent', nodeId: f.id, title: 'Lead' },
    })
    vi.useFakeTimers()
    try {
      guardNodeFromSyncOverwrite(f.id)
      const latest = ensurePersistedWorkspace(f.latest().workspaces[0])!
      const base = ensurePersistedWorkspace(f.ancestor.workspaces[0])!
      const rebased = toShellWorkspaceStateForSync(
        latest,
        f.localWorkspace,
        withBase ? base : undefined,
      )
      expect(rebased.nodes[0].data).toMatchObject({
        title: 'Lead',
        titlePinnedByUser: true,
        titleIsLiteral: true,
      })
      expect(rebased.nodes[0].position).toEqual({ x: 42, y: 0 })
      const late = applyAgentSessionTitleToNodes(rebased.nodes, f.target, 'Even later title')
      expect(late.didChange).toBe(false)
      expect(late.nextNodes[0].data.title).toBe('Lead')
    } finally {
      vi.advanceTimersByTime(2_000)
      isNodeGuardedFromSyncOverwrite(f.id)
      vi.useRealTimers()
    }
  },
)

it.each([true, false])(
  'preserves pin authority even when an ancestor is unavailable: %s',
  async withAncestor => {
    const f = fixture()
    await updateNodeForNodeControl({
      store: f.store,
      input: { kind: 'agent', nodeId: f.id, title: 'Lead' },
    })
    const result = mergePersistedAppStates(f.latest(), f.local, withAncestor ? f.ancestor : null)
    expect(result.workspaces[0].nodes[0]).toMatchObject({
      title: 'Lead',
      titlePinnedByUser: true,
      titleIsLiteral: true,
      position: { x: 42, y: 0 },
    })
  },
)

it('merges an explicit competing UI rename as one naming intent, without mixing literal flags', async () => {
  const f = fixture()
  await updateNodeForNodeControl({
    store: f.store,
    input: { kind: 'agent', nodeId: f.id, title: 'Lead' },
  })
  const local = structuredClone(f.local)
  Object.assign(local.workspaces[0].nodes[0], {
    title: 'codex · UI name',
    titlePinnedByUser: true,
    titleIsLiteral: false,
  })
  expect(
    mergePersistedAppStates(f.latest(), local, f.ancestor).workspaces[0].nodes[0],
  ).toMatchObject({ title: 'codex · UI name', titlePinnedByUser: true, titleIsLiteral: false })
})

it('keeps automatic session naming enabled when neither side is pinned', () => {
  const f = fixture()
  expect(
    mergePersistedAppStates(f.ancestor, f.local, f.ancestor).workspaces[0].nodes[0],
  ).toMatchObject({ title: 'codex · Late session title', titlePinnedByUser: false })
})
