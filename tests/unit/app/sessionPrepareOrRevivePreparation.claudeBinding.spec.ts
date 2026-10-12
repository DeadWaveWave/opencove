import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareAgentNode } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrRevivePreparation'
import { normalizePersistedAgent } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveShared'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { encodeClaudeProjectPath } from '../../../src/contexts/agent/infrastructure/ClaudeProjectPaths'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { ensurePersistedWorkspace } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { normalizePersistedAppState } from '../../../src/platform/persistence/sqlite/normalize'
import { resolveHomeDirectoryCandidates } from '../../../src/platform/os/HomeDirectory'
import type { PreparedRuntimeAgentResult } from '../../../src/shared/contracts/dto'

const sessionA = '11111111-1111-4111-8111-111111111111'
const sessionB = '22222222-2222-4222-8222-222222222222'
const unrelatedSession = '33333333-3333-4333-8333-333333333333'
const startedAt = '2026-05-01T00:00:00.000Z'
let root: string
let home: string
let cwd: string

beforeEach(async () => {
  root = await mkdtemp(join(os.tmpdir(), 'opencove-claude-recovery-'))
  home = join(root, 'home')
  cwd = join(root, 'workspace')
  await Promise.all([mkdir(home), mkdir(cwd)])
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('HOMEDRIVE', '')
  vi.stubEnv('HOMEPATH', '')
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(home, '.claude'))
  const userInfo = os.userInfo()
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  vi.spyOn(os, 'userInfo').mockReturnValue({ ...userInfo, homedir: home })
  expect(resolveHomeDirectoryCandidates()).toEqual([home])
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

async function transcript(id: string, directory = cwd): Promise<void> {
  const project = join(home, '.claude', 'projects', encodeClaudeProjectPath(directory))
  await mkdir(project, { recursive: true })
  const file = join(project, `${id}.jsonl`)
  await writeFile(
    file,
    `${JSON.stringify({ type: 'user', sessionId: id, cwd: directory, timestamp: startedAt })}\n`,
  )
  const timestamp = new Date(Date.parse(startedAt) + 1000)
  await utimes(file, timestamp, timestamp)
}

function agent(overrides: Partial<PreparedRuntimeAgentResult> = {}): PreparedRuntimeAgentResult {
  return normalizePersistedAgent({
    provider: 'claude-code',
    prompt: 'Synthetic fixture',
    executionDirectory: cwd,
    resumeSessionId: null,
    resumeSessionIdVerified: false,
    ...overrides,
  })!
}

async function prepare(
  record: PreparedRuntimeAgentResult,
  options: { assignedSessionId?: string; failResume?: boolean } = {},
) {
  const workspace = normalizePersistedAppState({
    workspaces: [
      {
        id: 'workspace',
        name: 'Workspace',
        path: cwd,
        nodes: [
          {
            id: 'agent',
            kind: 'agent',
            title: 'Claude',
            width: 500,
            height: 300,
            position: { x: 0, y: 0 },
            status: 'exited',
            startedAt,
            workerBinding: { endpointId: 'local', mountId: null },
            agent: record,
          },
        ],
      },
    ],
  })!.workspaces[0]!
  const calls: { id: string; mode?: string; resumeSessionId?: string | null }[] = []
  const controlSurface = {
    invoke: vi.fn(async (_ctx, request) => {
      const payload = request.payload as { mode?: string; resumeSessionId?: string | null }
      calls.push({ id: request.id, mode: payload.mode, resumeSessionId: payload.resumeSessionId })
      if (options.failResume && payload.mode === 'resume') {
        throw new Error('Synthetic missing transcript')
      }
      return {
        ok: true,
        value: {
          sessionId: 'test-pty',
          provider: 'claude-code',
          effectiveModel: null,
          resumeSessionId: options.assignedSessionId ?? null,
        },
      }
    }),
  } as ControlSurface
  const result = await prepareAgentNode({
    controlSurface,
    ctx: { now: () => new Date('2026-05-02T00:00:00.000Z') } as never,
    store: {} as never,
    workspace,
    node: workspace.nodes[0]!,
    space: null,
    agent: record,
    settings: DEFAULT_AGENT_SETTINGS,
  })
  return { result, calls, workspace }
}

describe('Claude recovery binding ownership', () => {
  it('never promotes one same-directory transcript into two unknown node bindings', async () => {
    await transcript(unrelatedSession)
    const outcomes = await Promise.all([prepare(agent()), prepare(agent())])
    for (const { result, calls } of outcomes) {
      expect(calls.map(call => call.id)).toEqual(['pty.spawn'])
      expect(result.agent?.resumeSessionId).toBeNull()
      expect(result.agent?.resumeSessionIdVerified).toBe(false)
    }
  })

  it('does not resume a legacy ID lacking verification even when another transcript exists', async () => {
    await transcript(unrelatedSession)
    const record = normalizePersistedAgent({
      provider: 'claude-code',
      prompt: 'Legacy fixture',
      executionDirectory: cwd,
      resumeSessionId: sessionA,
    })!
    const { calls, result } = await prepare(record)
    expect(calls.map(call => call.id)).toEqual(['pty.spawn'])
    expect(result.agent?.resumeSessionIdVerified).toBe(false)
  })

  it('retains distinct verified IDs when their transcript files are unavailable', async () => {
    await transcript(unrelatedSession)
    const outcomes = await Promise.all(
      [sessionA, sessionB].map(resumeSessionId =>
        prepare(agent({ resumeSessionId, resumeSessionIdVerified: true })),
      ),
    )
    expect(outcomes.map(({ calls }) => calls[0]?.resumeSessionId)).toEqual([sessionA, sessionB])
    expect(outcomes.map(({ result }) => result.agent?.resumeSessionId)).toEqual([
      sessionA,
      sessionB,
    ])
  })

  it('keeps a verified binding after exact resume fails instead of selecting another transcript', async () => {
    await transcript(unrelatedSession)
    const { calls, result } = await prepare(
      agent({ resumeSessionId: sessionA, resumeSessionIdVerified: true }),
      { failResume: true },
    )
    expect(calls).toEqual([
      { id: 'session.launchAgent', mode: 'resume', resumeSessionId: sessionA },
      { id: 'pty.spawn', mode: undefined, resumeSessionId: undefined },
    ])
    expect(result.recoveryState).toBe('fallback_terminal')
    expect(result.agent?.resumeSessionId).toBe(sessionA)
    expect(result.agent?.resumeSessionIdVerified).toBe(true)
  })

  it('persists the assigned identity of a restarted blank agent for its next recovery', async () => {
    const first = await prepare(agent({ prompt: '' }), { assignedSessionId: sessionA })
    expect(first.calls[0]).toEqual({
      id: 'session.launchAgent',
      mode: 'new',
      resumeSessionId: null,
    })
    expect(first.result.agent?.resumeSessionId).toBe(sessionA)
    expect(first.result.agent?.resumeSessionIdVerified).toBe(true)
    const restored = ensurePersistedWorkspace(
      JSON.parse(
        JSON.stringify({
          ...first.workspace,
          nodes: [{ ...first.workspace.nodes[0], agent: first.result.agent }],
        }),
      ),
    )!
    const second = await prepare(normalizePersistedAgent(restored.nodes[0]!.agent)!)
    expect(second.calls[0]).toEqual({
      id: 'session.launchAgent',
      mode: 'resume',
      resumeSessionId: sessionA,
    })
  })
})
