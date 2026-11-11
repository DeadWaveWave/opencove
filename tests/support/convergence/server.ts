import { vi } from 'vitest'
import { sqliteWireState } from './sqliteWire'
import { normalizePersistedAppState } from '@platform/persistence/sqlite/normalize'
import { invalidStateResult } from '@platform/persistence/sqlite/appStateWriteResult'
import { createBrowserPersistenceApi } from '@app/renderer/browser/browserOpenCoveApi.persistence'
import { createRemotePersistenceStore } from '@app/main/controlSurface/remote/remotePersistenceStore'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import { ServerModel, type Response } from './model'
import { snapshot, value } from './fixture'
export type Adapter = 'local' | 'remote' | 'web' | 'raw' | 'raw-remote' | 'raw-web'
export class Server {
  readonly model = new ServerModel()
  writes = 0
  notifyCommit: () => void = () => {}
  delayResponse = false
  delayCommitMs = 0
  delayReadMs = 0
  private replies: Array<() => void> = []
  reply() {
    this.delayResponse = false
    this.replies.splice(0).forEach(reply => reply())
  }
  async submit(state: PersistedAppState, raw = false) {
    if (this.delayCommitMs) {
      await new Promise(resolve => setTimeout(resolve, this.delayCommitMs))
    }
    let result: ReturnType<Server['write']> | undefined, failure: unknown
    try {
      result = this.write(state, raw)
    } catch (error) {
      failure = error
    }
    if (this.delayResponse) {
      await new Promise<void>(resolve => this.replies.push(resolve))
    }
    if (failure) {
      throw failure
    }
    return result!
  }
  scrollbacks = new Map<string, string>()
  nextReadNull = false
  failRead = false
  stale: { state: PersistedAppState; revision: number } | null = null
  constructor(
    readonly template: PersistedAppState,
    public response: Response,
  ) {}
  read() {
    if (this.failRead) {
      throw new Error('read unavailable')
    }
    if (this.nextReadNull) {
      this.nextReadNull = false
      return { state: null, revision: 0, recovery: null }
    }
    return {
      ...(this.stale
        ? { ...this.stale, state: sqliteWireState(this.stale.state) }
        : {
            state: sqliteWireState(snapshot(this.template, this.model.value)),
            revision: this.model.revision,
          }),
      recovery: null,
    }
  }
  write(state: PersistedAppState, raw = false) {
    this.writes++
    if (!normalizePersistedAppState(state)) {
      const invalid = invalidStateResult('Workspace state payload must be a JSON object.')
      if (!invalid.ok) {
        throw invalid.error
      }
    }
    if (this.model.unknown) {
      this.model.replayViolation = true
    }
    const tupleCorrected =
      !!this.template.workspaces[0].nodes[0].managedClaudeResumeBindingOwnership &&
      (value(state).tuple !== this.model.value.tuple ||
        state.workspaces[0].nodes[0].agent?.resumeSessionIdVerified !== this.model.verified)
    const response = this.response
    this.response = 'committed'
    if (response === 'rejected' || response === 'identity') {
      if (response === 'rejected') {
        const invalid = invalidStateResult('Workspace state payload must be a JSON object.')
        if (!invalid.ok) {
          throw invalid.error
        }
      }
      throw {
        code:
          response === 'identity'
            ? 'persistence.owned_node_identity_conflict'
            : 'persistence.invalid_state',
        debugMessage: 'Write rejected',
        details: { nodeId: 'agent', field: 'agent', reason: 'incompatible' },
      }
    }
    if (response.startsWith('lost')) {
      this.model.unknown = true
    }
    if (response !== 'lost-uncommitted') {
      const next = value(state)
      // Server owns the tuple, independently of the renderer's projection helper.
      if (this.template.workspaces[0].nodes[0].managedClaudeResumeBindingOwnership) {
        next.tuple = this.model.value.tuple
      }
      this.model.commit(next)
      // Preserve persisted wire fields outside the oracle's intent vocabulary, as SQLite does.
      const stored = sqliteWireState(state)
      for (const workspace of stored.workspaces) {
        for (const node of workspace.nodes) {
          const owner = this.template.workspaces
            .flatMap(w => w.nodes)
            .find(n => n.id === node.id)?.managedClaudeResumeBindingOwnership
          if (owner) {
            node.managedClaudeResumeBindingOwnership = structuredClone(owner)
            if (node.agent) {
              node.agent.resumeSessionId = this.model.value.tuple
              node.agent.resumeSessionIdVerified = this.model.verified
            }
          }
        }
      }
      Object.assign(this.template, stored)
      this.notifyCommit()
    }
    if (response.startsWith('lost')) {
      throw new Error('Response lost')
    }
    const receipt = {
      revision: this.model.revision,
      corrected: response === 'corrected' || tupleCorrected,
    }
    return raw
      ? { ...receipt, ok: true, level: 'full', bytes: 1 }
      : { ...receipt, ...(response === 'merged' ? { merged: true } : {}) }
  }
  async invoke(id: string, payload: Record<string, unknown>) {
    if (id === 'system.capabilities') {
      return { features: { managedClaudeResumeBindingDeliveryV1: true } }
    }
    if (id === 'sync.state') {
      if (this.delayReadMs) {
        await new Promise(resolve => setTimeout(resolve, this.delayReadMs))
      }
      return this.read()
    }
    if (id === 'sync.writeState') {
      return await this.submit(payload.state as PersistedAppState)
    }
    if (id === 'sync.writeWorkspaceStateRaw') {
      return await this.raw(payload.raw as string)
    }
    if (id === 'sync.readWorkspaceStateRaw') {
      return JSON.stringify(this.read().state)
    }
    if (id === 'sync.readNodeScrollback') {
      return this.scrollbacks.get(payload.nodeId as string) ?? null
    }
    if (id === 'sync.writeNodeScrollback') {
      this.scrollbacks.set(payload.nodeId as string, payload.scrollback as string)
      return { ok: true, level: 'full', bytes: 1 }
    }
    return null
  }
  async raw(raw: string) {
    let state: PersistedAppState
    try {
      state = JSON.parse(raw)
    } catch {
      return invalidStateResult('Workspace state payload must be a JSON object.')
    }
    try {
      return await this.submit(state, true)
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      return { ok: false, reason: 'unknown', error }
    }
  }
  api(adapter: Adapter): Window['opencoveApi']['persistence'] {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        const { id, payload } = JSON.parse(options!.body as string)
        try {
          const result = await this.invoke(id, payload ?? {})
          return {
            status: 200,
            text: async () =>
              JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value: result }),
          }
        } catch (error) {
          if (error instanceof Error) {
            throw error
          }
          return {
            status: 200,
            text: async () => JSON.stringify({ __opencoveControlEnvelope: true, ok: false, error }),
          }
        }
      }),
    )
    if (adapter === 'raw-web') {
      adapter = 'web'
    }
    if (adapter === 'raw-remote') {
      adapter = 'remote'
    }
    if (adapter === 'web') {
      return createBrowserPersistenceApi()
    }
    if (adapter === 'remote') {
      const remote = createRemotePersistenceStore(async () => ({
        hostname: '127.0.0.1',
        port: 1234,
        token: 'fixture',
      }))
      return {
        readAppState: async () => ({ ...(await remote.readAppStateSnapshot!()), recovery: null }),
        writeAppState: async p => remote.writeAppState(p.state, p),
        writeWorkspaceStateRaw: async p => remote.writeWorkspaceStateRaw(p.raw),
        readWorkspaceStateRaw: remote.readWorkspaceStateRaw,
        writeNodeScrollback: async p => remote.writeNodeScrollback(p.nodeId, p.scrollback),
        readNodeScrollback: async p => remote.readNodeScrollback(p.nodeId),
        writeAgentNodePlaceholderScrollback: async () => ({ ok: true, level: 'full', bytes: 0 }),
        readAgentNodePlaceholderScrollback: async () => null,
      }
    }
    return {
      readAppState: async () => {
        if (this.delayReadMs) {
          await new Promise(resolve => setTimeout(resolve, this.delayReadMs))
        }
        return this.read()
      },
      writeAppState: async p => {
        try {
          return {
            ok: true,
            level: 'full',
            bytes: 1,
            ...(await this.submit(p.state as PersistedAppState)),
          }
        } catch (error) {
          if (error instanceof Error) {
            throw error
          }
          return { ok: false, reason: 'unknown', error }
        }
      },
      writeWorkspaceStateRaw: async p => {
        try {
          return await this.raw(p.raw)
        } catch (error) {
          if (error instanceof Error) {
            throw error
          }
          return { ok: false, reason: 'unknown', error }
        }
      },
      readWorkspaceStateRaw: async () => JSON.stringify(this.read().state),
      writeNodeScrollback: async p => {
        this.scrollbacks.set(p.nodeId, p.scrollback!)
        return { ok: true, level: 'full', bytes: 1 }
      },
      readNodeScrollback: async p => this.scrollbacks.get(p.nodeId) ?? null,
      writeAgentNodePlaceholderScrollback: async () => ({ ok: true, level: 'full', bytes: 0 }),
      readAgentNodePlaceholderScrollback: async () => null,
    } as Window['opencoveApi']['persistence']
  }
}
