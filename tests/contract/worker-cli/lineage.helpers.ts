import { expect } from '@playwright/test'
import { withWorker, type WorkerFixture } from './fixture'
import { writeLineageAgentStub, grantedAgentCli } from '../../e2e/cli.agent-lineage.helpers'
import type { CreateNodeResult } from '../../../src/shared/contracts/dto/nodeControl'
export { expectSpawnRefusal } from '../../e2e/cli.bounded-agent-spawning.helpers'
export const projectId = 'bounded-project'

async function ready(worker: WorkerFixture, node: { id: string; sessionId?: string | null }) {
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
