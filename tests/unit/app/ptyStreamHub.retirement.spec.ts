import { afterEach, describe, expect, it, vi } from 'vitest'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { PtyStreamRetiredSessions } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub.retirement'
import { PluginTargetOperations } from '../../../src/contexts/plugins/application/PluginTargetOperations'
import type { PluginResolvedTarget } from '../../../src/contexts/plugins/domain/pluginHostTypes'

const target: PluginResolvedTarget = {
  projectId: 'project',
  spaceId: null,
  mountId: 'mount',
  endpointId: 'remote',
  rootUri: 'file:///repo',
  cwdUri: 'file:///repo',
  workingDirectory: '/repo',
}
function fixture() {
  vi.useFakeTimers()
  const kill = vi.fn()
  const hub = new PtyStreamHub({
    replayWindowMaxBytes: 64_000,
    ptyRuntime: {
      spawnSession: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill,
      onData: () => () => undefined,
      onExit: () => () => undefined,
    },
  })
  const metadata = {
    sessionId: 'ephemeral-job',
    kind: 'terminal' as const,
    startedAt: '2026-10-11T00:00:00.000Z',
    cwd: '/repo',
    command: 'tool',
    args: [],
    cols: 80,
    rows: 24,
  }
  const jobs = new PluginTargetOperations(
    {
      spawn: async () => {
        hub.registerSessionMetadata(metadata)
        return metadata.sessionId
      },
      snapshot: sessionId => {
        const value = hub.snapshotSession(sessionId)
        const state = hub.listSessions().sessions.find(item => item.sessionId === sessionId)!
        return {
          output: value.scrollback,
          truncated: value.truncated,
          exitCode: state.exitCode,
          exited: state.status === 'exited',
        }
      },
      kill,
      forget: sessionId => hub.retireSession(sessionId),
    },
    () => 'job',
  )
  return { hub, metadata, jobs, kill }
}
afterEach(() => vi.useRealTimers())

describe('ephemeral PTY session retirement', () => {
  it('bounds idle retirement history while retaining identities with continuing late events', () => {
    const retired = new PtyStreamRetiredSessions(2)
    retired.retire('streaming')
    retired.retire('idle')
    expect(retired.has('streaming')).toBe(true)
    retired.retire('recent')
    expect(retired.has('idle')).toBe(false)
    expect(retired.has('streaming')).toBe(true)
    expect(retired.has('recent')).toBe(true)
  })

  it('fences an identity retired before its delayed session registration arrives', () => {
    const { hub, metadata } = fixture()
    hub.retireSession(metadata.sessionId)
    hub.handlePtyData(metadata.sessionId, 'late spawn output')
    hub.registerSessionMetadata(metadata)
    hub.handlePtyExit(metadata.sessionId, 143)
    expect(hub.hasSession(metadata.sessionId)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not recreate a cancelled plugin job when remote output, exit or metadata arrives late', async () => {
    const { hub, metadata, jobs, kill } = fixture()
    const op = jobs.start({ ownerId: 'plugin', assertActive: () => {} }, target, 'tool', [], 100)
    await vi.advanceTimersByTimeAsync(100)
    expect(kill).toHaveBeenCalledWith(metadata.sessionId)
    await vi.advanceTimersByTimeAsync(5100)
    expect(jobs.get('plugin', op.operationId)).toMatchObject({ status: 'failed' })
    expect(hub.hasSession(metadata.sessionId)).toBe(false)
    hub.handlePtyData(metadata.sessionId, 'remote output after cancellation')
    hub.handlePtyExit(metadata.sessionId, 143)
    hub.registerSessionMetadata(metadata)
    hub.registerSessionAgentState({
      sessionId: metadata.sessionId,
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })
    hub.registerSessionAgentMetadata({ sessionId: metadata.sessionId, resumeSessionId: 'late' })
    await vi.advanceTimersByTimeAsync(100)
    expect(hub.hasSession(metadata.sessionId)).toBe(false)
    expect(hub.listSessions().sessions).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await expect(
      hub.restoreSessionPresentationBaseline({
        sessionId: metadata.sessionId,
        serializedScreen: 'late baseline',
      }),
    ).rejects.toThrow('retired')
    await jobs.retire('plugin')
  })

  it('keeps ordinary forget-and-restore terminal semantics and active neighbors unchanged', async () => {
    const { hub, metadata } = fixture()
    vi.useRealTimers()
    const terminal = { ...metadata, sessionId: 'regular-terminal' }
    hub.registerSessionMetadata(metadata)
    hub.registerSessionMetadata(terminal)
    hub.retireSession(metadata.sessionId)
    hub.handlePtyData(terminal.sessionId, 'still usable')
    expect(hub.snapshotSession(terminal.sessionId).scrollback).toBe('still usable')
    hub.forgetSession(terminal.sessionId)
    await hub.restoreSessionPresentationBaseline({
      sessionId: terminal.sessionId,
      serializedScreen: 'restored',
    })
    hub.registerSessionMetadata(terminal)
    expect(hub.listSessions().sessions.map(item => item.sessionId)).toEqual([terminal.sessionId])
    hub.handlePtyExit(terminal.sessionId, 0)
    expect(hub.listSessions().sessions[0].status).toBe('exited')
    hub.forgetSession(terminal.sessionId)
  })
})
