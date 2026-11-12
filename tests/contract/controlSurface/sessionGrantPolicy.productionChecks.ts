/* eslint-disable no-await-in-loop -- Each request observes the preceding mutation or authorization boundary. */
import { expect, vi } from 'vitest'
import { SESSION_GRANT_POLICY } from '../../../src/app/main/controlSurface/http/sessionGrantPolicy'
import { REQUIRED_SESSION_GRANT_DENIALS } from './sessionGrantPolicy.expectations'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'

type Invoke = (
  id: string,
  payload: unknown,
  token?: string,
  kind?: string,
) => Promise<{
  status: number
  result: { ok: boolean; error?: unknown; value: { node: { id: string; sessionId: string } } }
}>
// All handlers and their nested dispatch are from the production composition. Only PTY IO
// and the listening socket are test ports; this helper never registers operation stubs.
export async function checkProductionGrantPolicy(options: {
  invoke: Invoke
  token: string
  surface: ControlSurface
  store: PersistenceStore
  spawnCount(): number
  writeCount(): number
  killCount(): number
}) {
  const { invoke, token, surface, store } = options
  const before = await store.readAppState()
  const spawns = options.spawnCount(),
    writes = options.writeCount(),
    kills = options.killCount()
  const ctx = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  for (const op of REQUIRED_SESSION_GRANT_DENIALS) {
    expect(SESSION_GRANT_POLICY[op.id].access, op.id).toBe('deny')
  }
  for (const op of REQUIRED_SESSION_GRANT_DENIALS) {
    const denied = await invoke(op.id, null, token, op.kind)
    expect(denied, op.id).toMatchObject({
      status: 403,
      result: {
        ok: false,
        error: {
          code: 'common.forbidden',
          details: { reason: 'operation_denied', operationId: op.id },
        },
      },
    })
    // Null is deliberately invalid for mutation payloads, but valid for protected state reads.
    // Compare whole envelopes under both trusted caller kinds through the real handlers.
    if (op.scope === 'admin') {
      continue
    } // Existing admin transport restrictions are unchanged.
    const request = { id: op.id, kind: op.kind, payload: null }
    const bearer = await surface.invoke({ ...ctx, requestAuth: { kind: 'bearer' } }, request)
    const cookie = await surface.invoke(
      { ...ctx, requestAuth: { kind: 'cookie', webSessionGeneration: 0 } },
      request,
    )
    expect(cookie, op.id).toEqual(bearer)
  }
  expect(await store.readAppState()).toEqual(before)
  expect(options.spawnCount()).toBe(spawns)
  expect(options.writeCount()).toBe(writes)
  expect(options.killCount()).toBe(kills)
  for (const id of ['session.launchAgent', 'session.launchAgentInMount']) {
    const target = id.endsWith('InMount') ? { mountId: 'missing' } : { spaceId: 'space' }
    for (const [field, value] of Object.entries({
      agentFullAccess: true,
      env: { KEY: 'private' },
      executablePathOverride: '/bin/sh',
      resumeSessionId: 'old',
      codexReuseRunningAppServer: true,
      mode: 'resume',
    })) {
      expect(
        (await invoke(id, { ...target, prompt: 'Explain this project', [field]: value }, token))
          .result,
      ).toMatchObject({
        ok: false,
        error: { code: 'common.forbidden', details: { reason: 'field_denied', field } },
      })
    }
  }
  expect(options.spawnCount()).toBe(spawns)
  expect(options.writeCount()).toBe(writes)
  expect(options.killCount()).toBe(kills)
  expect(await store.readAppState()).toEqual(before)
  for (const kind of ['terminal', 'agent'] as const) {
    const killsBeforeDelete = options.killCount()
    const created = await invoke(
      'node.create',
      {
        kind,
        space: { kind: 'spaceId', spaceId: 'space' },
        data: kind === 'agent' ? { provider: 'codex', prompt: 'Explain this project' } : {},
      },
      token,
    )
    expect(created.result.error).toBeUndefined()
    expect(created.result.ok).toBe(true)
    const node = created.result.value.node
    expect(node.sessionId).toBeTruthy()
    expect((await invoke('node.delete', { nodeId: node.id }, token)).result).toMatchObject({
      ok: true,
    })
    expect(options.killCount()).toBeGreaterThan(killsBeforeDelete)
    expect(JSON.stringify(await store.readAppState())).not.toContain(node.id)
  }
  const stateBeforeFailure = await store.readAppState()
  const killsBeforeFailure = options.killCount()
  const save = vi.spyOn(store, 'commitCreatedNodeState').mockResolvedValueOnce({
    ok: false,
    reason: 'unknown',
    error: { code: 'persistence.io_failed' },
  })
  try {
    const failed = await invoke(
      'node.create',
      { kind: 'terminal', space: { kind: 'spaceId', spaceId: 'space' }, data: {} },
      token,
    )
    expect(failed.result).toMatchObject({ ok: false, error: { code: 'persistence.io_failed' } })
    expect(options.killCount()).toBe(killsBeforeFailure + 1)
    expect(await store.readAppState()).toEqual(stateBeforeFailure)
    const failedId = save.mock.calls[0][1].lineage.nodeId
    expect((await store.nodeLineage!.readMany([failedId])).size).toBe(0)
  } finally {
    save.mockRestore()
  }
}
