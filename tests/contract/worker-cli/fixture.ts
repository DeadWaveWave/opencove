import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect } from '@playwright/test'
import type { GetSessionSnapshotResult } from '../../../src/shared/contracts/dto/controlSurface'
import type { CreateNodeResult } from '../../../src/shared/contracts/dto/nodeControl'
import {
  reserveLoopbackPort,
  startRemoteWorker,
  stopRemoteWorker,
} from '../../e2e/m6.endpoints-mounts.integration.helpers'
import { alive, descendants } from './processes'

export type Binding = { nodeId: string; sessionId: string }
export type WorkerFixture = Awaited<ReturnType<typeof startWorkerFixture>>

export async function startWorkerFixture(
  options: {
    agentSessionScenario?: string
    prepare?: (root: string) => Promise<Record<string, string>>
  } = {},
) {
  const base = resolve('artifacts/worker-cli')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'case-'))
  const workspace = join(root, 'project')
  const profile = join(root, 'profile')
  const port = await reserveLoopbackPort()
  const token = randomUUID()
  let worker: Awaited<ReturnType<typeof startRemoteWorker>> | undefined
  try {
    await mkdir(workspace)
    worker = await startRemoteWorker({
      hostname: '127.0.0.1',
      port,
      token,
      userDataDir: profile,
      homeDir: join(root, 'home'),
      approveRoot: root,
      agentSessionScenario: options.agentSessionScenario ?? 'stdin-echo',
      env: {
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath,
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_TEST_CODEX_HOOK_INSTALL_FAILURE: '0',
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
        ...(await options.prepare?.(root)),
      },
    })
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
  const handle = worker
  const observedPids = new Set<number>([handle.child.pid!])
  async function recordProcesses() {
    for (const pid of await descendants(handle.child.pid!)) {
      observedPids.add(pid)
    }
  }
  async function invoke<T = unknown>(
    id: string,
    payload: unknown = null,
    kind: 'command' | 'query' = 'command',
  ): Promise<T> {
    const response = await fetch(`http://127.0.0.1:${port}/invoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        kind,
        payload,
        clientFeatures: { managedClaudeResumeBindingV1: true },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const envelope = await response.json()
    if (!response.ok || !envelope.ok) {
      throw new Error(`${id}: ${JSON.stringify(envelope)}\n${handle.logs()}`)
    }
    await recordProcesses()
    return envelope.value as T
  }
  return {
    root,
    workspace,
    profile,
    invoke,
    async seed(
      projectId: string,
      nodes: unknown[] = [],
      spaces: unknown[] = [],
      settings: Record<string, unknown> = {},
    ) {
      const result = await invoke<{ ok: boolean }>('sync.writeWorkspaceStateRaw', {
        raw: JSON.stringify({
          formatVersion: 1,
          activeWorkspaceId: projectId,
          settings,
          workspaces: [
            {
              id: projectId,
              name: 'CLI contract',
              path: workspace,
              activeSpaceId: null,
              nodes,
              spaces,
            },
          ],
        }),
      })
      expect(result.ok).toBe(true)
      await invoke('mount.create', {
        projectId,
        endpointId: 'local',
        rootPath: workspace,
        name: 'Local',
      })
    },
    async createTerminal(
      projectId: string,
      kind: 'terminal' | 'agent' = 'terminal',
      spaceId?: string,
    ): Promise<Binding> {
      const result = await invoke<CreateNodeResult>('node.create', {
        projectId,
        kind,
        title: kind === 'agent' ? 'Reader' : 'Shell',
        ...(spaceId ? { space: { kind: 'spaceId', spaceId } } : {}),
        frame: { x: kind === 'agent' ? 850 : 20, y: 20, width: 760, height: 540 },
        data: kind === 'agent' ? { provider: 'codex', prompt: '' } : { shell: '/bin/sh' },
      })
      expect(result.node.sessionId, 'Created node owns a real PTY').toBeTruthy()
      return { nodeId: result.node.id, sessionId: result.node.sessionId! }
    },
    async snapshot(sessionId: string) {
      return (await invoke<GetSessionSnapshotResult>('session.snapshot', { sessionId }, 'query'))
        .scrollback
    },
    async close() {
      await recordProcesses()
      try {
        await stopRemoteWorker(handle.child)
        await expect
          .poll(() => [...observedPids].filter(alive), {
            timeout: 10_000,
            message: `Worker and every observed PTY descendant must exit: ${handle.logs()}`,
          })
          .toEqual([])
      } finally {
        // Failed cleanup must still leave no fixture-owned processes on the shared machine.
        for (const pid of observedPids) {
          if (alive(pid)) {
            process.kill(pid, 'SIGKILL')
          }
        }
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}

export async function withWorker(
  execute: (worker: WorkerFixture) => Promise<void>,
  options: Parameters<typeof startWorkerFixture>[0] = {},
) {
  const worker = await startWorkerFixture(options)
  try {
    await execute(worker)
  } finally {
    await worker.close()
  }
}
