import { expect } from '@playwright/test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { withWorker, type WorkerFixture } from './fixture'
import { writeLineageAgentStub, grantedAgentCli } from '../../support/cliLineageAgent'
import type {
  CanvasNodeDetailDto,
  CreateNodeResult,
  GetNodeResult,
} from '../../../src/shared/contracts/dto/nodeControl'
import { alive } from './processes'
import { terminalCommand } from './terminal'
import type { PrepareOrReviveSessionResult } from '../../../src/shared/contracts/dto/controlSurface'
import type { PersistedAppStateContract } from '../../../src/shared/contracts/persistedAppState'
export { expectSpawnRefusal } from '../../support/boundedSpawning'
import { projectId } from '../../support/boundedSpawning'
export { projectId }

export async function ready(
  worker: WorkerFixture,
  node: { id: string; sessionId?: string | null },
) {
  await expect
    .poll(() => worker.snapshot(node.sessionId!), { timeout: 20_000 })
    .toContain('STRICT_READY')
  await worker.invoke('session.writeNode', {
    nodeId: node.id,
    sessionId: node.sessionId,
    data: 'manual baseline\r',
  })
  await expect
    .poll(
      async () =>
        (await worker.invoke<{ state: string }>('agent.get', { nodeId: node.id }, 'query')).state,
      { timeout: 20_000 },
    )
    .toBe('idle')
}

export async function boundedWorkspace(
  run: (fixture: {
    worker: WorkerFixture
    parent: CreateNodeResult['node']
    command: (node: { id: string }, args: string[]) => ReturnType<typeof grantedAgentCli>
    child: (
      caller: { id: string },
      kind?: 'agent' | 'terminal',
    ) => Promise<CreateNodeResult['node']>
  }) => Promise<void>,
) {
  await withWorker(
    async worker => {
      await worker.seed(projectId, [], [], { defaultProvider: 'claude-code' })
      const parent = (
        await worker.invoke<CreateNodeResult>('node.create', {
          kind: 'agent',
          projectId,
          title: 'Coordinator',
          data: { provider: 'claude-code', prompt: '' },
        })
      ).node
      await ready(worker, parent)
      const command = (node: { id: string }, args: string[]) =>
        grantedAgentCli(worker.root, node.id, args)
      await run({
        worker,
        parent,
        command,
        async child(caller, kind = 'agent') {
          const result = await command(caller, [
            'node',
            'create',
            kind,
            '--root-canvas',
            ...(kind === 'agent' ? ['--provider', 'claude-code'] : []),
            '--title',
            'Delegate',
          ])
          expect(result.code, result.stderr).toBe(0)
          const node = (JSON.parse(result.stdout) as CreateNodeResult).node
          if (kind === 'agent') {
            await ready(worker, node)
          }
          return node
        },
      })
    },
    {
      agentSessionScenario: 'claude-prompt-strict',
      prepare: async root => ({
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: await writeLineageAgentStub(root),
      }),
    },
  )
}

export async function stopAndWait(worker: WorkerFixture, node: { sessionId?: string | null }) {
  await worker.invoke('session.kill', { sessionId: node.sessionId })
  await expect
    .poll(
      async () =>
        (
          await worker.invoke<{ sessions: { sessionId: string; status: string }[] }>(
            'session.list',
            null,
            'query',
          )
        ).sessions.find(s => s.sessionId === node.sessionId)?.status,
      { timeout: 20_000 },
    )
    .toBe('exited')
}

export async function runtimeCounts(worker: WorkerFixture) {
  return {
    nodes: (await worker.invoke<{ nodes: unknown[] }>('node.list', { projectId }, 'query')).nodes
      .length,
    sessions: (await worker.invoke<{ sessions: unknown[] }>('session.list', null, 'query')).sessions
      .length,
  }
}

/** Observe the provider/shell itself, independently of persisted session IDs and hub status. */
export async function runtimePid(worker: WorkerFixture, node: CanvasNodeDetailDto) {
  let pid: number
  if (node.kind === 'agent') {
    const runtime = JSON.parse(await readFile(join(worker.root, node.id + '.runtime.json'), 'utf8'))
    expect(runtime.sessionId).toBe(node.sessionId)
    pid = runtime.pid
  } else {
    const output = await terminalCommand(
      worker,
      { nodeId: node.id, sessionId: node.sessionId! },
      process.platform === 'win32' ? 'Write-Output $PID' : 'printf "%s\\n" "$$"',
      'RUNTIME_PID',
    )
    pid = Number(output.match(/^\s*(\d+)\s*$/m)?.[1])
  }
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true)
  expect(await worker.liveProcesses()).toContain(pid)
  return pid
}

export async function expectRuntimeExited(pid: number) {
  await expect.poll(() => alive(pid), { timeout: 20_000 }).toBe(false)
}

export async function restartLineageWorker(worker: WorkerFixture, recovered: { id: string }) {
  await rm(join(worker.root, recovered.id + '.ready'), { force: true })
  await worker.restart()
  return reviveNode(worker, recovered.id)
}

export async function reviveNode(worker: WorkerFixture, nodeId: string) {
  const prepared = await worker.invoke<PrepareOrReviveSessionResult>('session.prepareOrRevive', {
    workspaceId: projectId,
    nodeIds: [nodeId],
  })
  const runtime = prepared.nodes.find(node => node.nodeId === nodeId)!
  expect(runtime.sessionId, JSON.stringify(runtime)).toBeTruthy()
  if (runtime.kind === 'terminal') {
    // Terminal recovery returns a runtime receipt; the client publishes that binding.
    // Exercise the real sync protocol, as Desktop hydration does, without inventing sessions.
    const { state, revision } = await worker.invoke<{
      state: PersistedAppStateContract<Record<string, unknown>>
      revision: number
    }>('sync.state', null, 'query')
    const persisted = state.workspaces
      .flatMap(workspace => workspace.nodes)
      .find(node => node.id === nodeId)!
    persisted.sessionId = runtime.sessionId
    persisted.workerBinding = runtime.workerBinding
    await worker.invoke('sync.writeState', { state, baseRevision: revision })
  }
  const node = (await worker.invoke<GetNodeResult>('node.get', { nodeId }, 'query')).node
  expect(node.sessionId).not.toBeNull()
  if (node.kind === 'agent') {
    await expect
      .poll(
        async () => {
          try {
            return await readFile(join(worker.root, nodeId + '.ready'), 'utf8')
          } catch {
            return ''
          }
        },
        { timeout: 30_000 },
      )
      .toBe('ready')
  }
  await expect
    .poll(
      async () =>
        (
          await worker.invoke<{ sessions: { sessionId: string; status: string }[] }>(
            'session.list',
            null,
            'query',
          )
        ).sessions.find(s => s.sessionId === node.sessionId)?.status,
      { timeout: 30_000 },
    )
    .toBe('running')
  await runtimePid(worker, node)
  return node
}
