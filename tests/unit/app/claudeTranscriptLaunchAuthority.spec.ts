import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
// @vitest-environment node
import fs from 'node:fs/promises'
import nativeFs from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import { ClaudeCodeAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/claude-code/ClaudeCodeAgentProviderContribution'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-launch-authority-'))
  const config = join(root, 'launch-config'),
    project = join(config, 'projects', 'p'),
    path = join(project, 'provider.jsonl')
  await fs.mkdir(project, { recursive: true })
  await fs.writeFile(path, '{}\n')
  const f = await hookChannelFixture({ environment: { CLAUDE_CONFIG_DIR: config } })
  const records: ClaudeTranscriptObservation[] = []
  f.channel.onClaudeTranscript?.(record => records.push(record))
  f.reservation.commit('s')
  cleanup.push(async () => {
    await f.channel.dispose()
    await fs.rm(root, { recursive: true, force: true })
  })
  return { ...f, root, config, project, path, records }
}
it('trusted config roots are captured from the launch environment rather than mutable Worker env', async () => {
  const f = await fixture()
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(f.root, 'different'))
  await f.post({
    session_id: 'provider',
    hook_event_name: 'SessionStart',
    transcript_path: f.path,
    cwd: '/unrelated',
  })
  await vi.waitFor(() =>
    expect(f.records.some(record => record.record?.kind === 'checkpoint')).toBe(true),
  )
})
it.each(['raw', 'versioned'])(
  'authenticated %s envelopes cannot select arbitrary paths for persistent IO',
  async form => {
    const f = await fixture(),
      outside = join(f.root, 'provider.jsonl')
    await fs.writeFile(outside, '{}')
    const open = vi.spyOn(fs, 'open'),
      watch = vi.spyOn(nativeFs, 'watch'),
      metadata = vi.spyOn(fs, 'lstat')
    const payload =
      form === 'raw'
        ? {
            session_id: 'provider',
            hook_event_name: 'SessionStart',
            transcript_path: outside,
            cwd: '/',
          }
        : {
            version: 1,
            state: null,
            claudeSessionId: 'provider',
            hookEventName: 'SessionStart',
            transcriptPath: outside,
          }
    expect(await f.post(payload)).toBe(204)
    await vi.waitFor(() => expect(f.records.some(record => record.unavailable)).toBe(true))
    expect(open).not.toHaveBeenCalled()
    expect(watch).not.toHaveBeenCalled()
    expect(metadata).not.toHaveBeenCalled()
  },
)
it('SessionEnd and SessionStart hand off the watcher and reject retired conversation hooks', async () => {
  const f = await fixture(),
    states: string[] = []
  f.channel.onState(event => states.push(event.hookEventName ?? ''))
  const send = (session: string, name: string, path: string, at: number) =>
    f.post({ session_id: session, hook_event_name: name, transcript_path: path, cwd: '/' }, at)
  const at = Date.now()
  await send('provider', 'SessionStart', f.path, at)
  await vi.waitFor(() =>
    expect(f.records.some(record => record.record?.kind === 'checkpoint')).toBe(true),
  )
  await send('provider', 'SessionEnd', f.path, at + 1)
  const next = join(f.project, 'next.jsonl')
  await fs.writeFile(next, '{}\n')
  await send('next', 'SessionStart', next, at + 2)
  await vi.waitFor(() =>
    expect(f.records.some(record => record.providerSessionId === 'next')).toBe(true),
  )
  await send('provider', 'Stop', f.path, at + 3)
  expect(states).toEqual(['SessionEnd'])
})
it('the Claude provider passes a per-launch environment into the hook reservation', async () => {
  const reserveSpawn = vi.fn(async () => ({
    usesHook: false,
    installState: 'not_installed' as const,
    env: null,
    commit() {},
    dispose: async () => {},
  }))
  const provider = new ClaudeCodeAgentProviderContribution({
    channel: {
      reserveSpawn,
      start: async () => {},
      onState: () => () => {},
      onMetadata: () => () => {},
      disposeSession() {},
      getInstallState: () => 'not_installed',
      getEndpoint: () => null,
      dispose: async () => {},
    },
  })
  const environment = { CLAUDE_CONFIG_DIR: '/trusted/per-launch' }
  await provider.hookInjection.prepareHookInjection({
    environment,
    artifacts: new AgentLaunchArtifactScope(),
    workspaceDirectory: '/',
  })
  expect(reserveSpawn).toHaveBeenCalledWith({ environment })
})
it('a supplied complete environment without a config key does not inherit the Worker config capability', async () => {
  const f = await fixture()
  vi.stubEnv('CLAUDE_CONFIG_DIR', f.config)
  const other = await hookChannelFixture({ environment: { PATH: '/bin' } })
  cleanup.push(async () => {
    await other.channel.dispose()
  })
  const records: ClaudeTranscriptObservation[] = []
  other.channel.onClaudeTranscript?.(record => records.push(record))
  other.reservation.commit('other')
  const open = vi.spyOn(fs, 'open')
  await other.post({
    session_id: 'provider',
    hook_event_name: 'SessionStart',
    transcript_path: f.path,
    cwd: '/',
  })
  await vi.waitFor(() => expect(records.some(record => record.unavailable)).toBe(true))
  expect(open).not.toHaveBeenCalled()
})
it('a valid secured transcript uses validated polling without a pathname native-watch capability', async () => {
  const f = await fixture(),
    watch = vi.spyOn(nativeFs, 'watch')
  await f.post({
    session_id: 'provider',
    hook_event_name: 'SessionStart',
    transcript_path: f.path,
    cwd: '/',
  })
  await vi.waitFor(() =>
    expect(f.records.some(record => record.record?.kind === 'checkpoint')).toBe(true),
  )
  expect(watch).not.toHaveBeenCalled()
})
it.each([undefined, ''])(
  'default transcript authority follows captured launch HOME with config=%s',
  async config => {
    const f = await fixture(),
      home = join(f.root, 'launch-home')
    const project = join(home, '.claude', 'projects', 'p'),
      path = join(project, 'provider.jsonl')
    await fs.mkdir(project, { recursive: true })
    await fs.writeFile(path, '{}\n')
    const other = await hookChannelFixture({
      environment: { HOME: home, CLAUDE_CONFIG_DIR: config },
    })
    cleanup.push(async () => {
      await other.channel.dispose()
    })
    const records: ClaudeTranscriptObservation[] = []
    other.channel.onClaudeTranscript?.(record => records.push(record))
    other.reservation.commit('s')
    await other.post({
      session_id: 'provider',
      hook_event_name: 'SessionStart',
      transcript_path: path,
      cwd: '/',
    })
    await vi.waitFor(() =>
      expect(records.some(record => record.record?.kind === 'checkpoint')).toBe(true),
    )
  },
)
