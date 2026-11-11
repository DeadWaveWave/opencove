import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import {
  createLineageAgent,
  establishLineageAgentReady,
  grantedAgentCli,
  writeLineageAgentStub,
} from './cli.agent-lineage.helpers'
import type {
  CanvasNodeDetailDto,
  CreateNodeResult,
} from '../../src/shared/contracts/dto/nodeControl'
export const projectId = 'bounded-project'
export async function boundedWorkspace(
  run: (fixture: Awaited<ReturnType<typeof start>>) => Promise<void>,
) {
  const f = await start()
  try {
    await run(f)
  } finally {
    await f.close()
  }
}
async function start() {
  const root = await mkdtemp(join(tmpdir(), 'opencove-bounded-'))
  const workspace = join(root, 'project'),
    profile = join(root, 'profile')
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const stub = await writeLineageAgentStub(root)
    const options = {
      userDataDir: profile,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: stub,
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-prompt-strict',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
      },
    }
    const launched = await launchApp(options)
    app = launched.electronApp
    let page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      settings: { defaultProvider: 'claude-code' },
      workspaces: [
        {
          id: projectId,
          name: 'Bounded project',
          path: workspace,
          activeSpaceId: null,
          spaces: [],
          nodes: [],
        },
      ],
    })
    const parent = (await createLineageAgent(page, projectId)).node
    await establishLineageAgentReady(page, parent)
    const command = (node: { id: string }, args: string[]) => grantedAgentCli(root, node.id, args)
    return {
      root,
      workspace,
      profile,
      parent,
      page: () => page,
      command,
      async child(caller: { id: string }, kind: 'agent' | 'terminal' = 'agent') {
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
          await establishLineageAgentReady(page, node)
        }
        return node
      },
      async restart(recovered: { id: string }) {
        await app!.close()
        app = undefined
        await rm(join(root, recovered.id + '.ready'), { force: true })
        const restarted = await launchApp(options)
        app = restarted.electronApp
        page = restarted.window
        await invoke(page, 'canvas.focus', { target: { kind: 'node', nodeId: recovered.id } })
        await expect
          .poll(
            async () => {
              try {
                return await readFile(join(root, recovered.id + '.ready'), 'utf8')
              } catch {
                return ''
              }
            },
            { timeout: 30_000 },
          )
          .toBe('ready')
        await expect
          .poll(
            async () =>
              (
                await invoke<{ node: CanvasNodeDetailDto }>(
                  page,
                  'node.get',
                  { nodeId: recovered.id },
                  'query',
                )
              ).node.sessionId,
            { timeout: 30_000 },
          )
          .not.toBeNull()
      },
      async close() {
        try {
          await app?.close()
        } finally {
          await removePathWithRetry(root)
        }
      },
    }
  } catch (error) {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
    throw error
  }
}
export function invoke<T = unknown>(
  page: Page,
  id: string,
  payload: unknown,
  kind: 'command' | 'query' = 'command',
): Promise<T> {
  return page.evaluate(async request => window.opencoveApi.controlSurface.invoke(request), {
    id,
    payload,
    kind,
  }) as Promise<T>
}
export async function runtimeCounts(page: Page) {
  return {
    nodes: (await invoke<{ nodes: unknown[] }>(page, 'node.list', { projectId }, 'query')).nodes
      .length,
    sessions: (await invoke<{ sessions: unknown[] }>(page, 'session.list', null, 'query')).sessions
      .length,
  }
}
export function expectSpawnRefusal(
  result: { code: number; stderr: string },
  code: string,
  exit: number,
) {
  expect(result.code, result.stderr).toBe(exit)
  const error = JSON.parse(result.stderr.trim().split('\n').at(-1)!).error
  expect(error).toMatchObject({
    code,
    retryable: false,
    message: expect.any(String),
    hint: expect.any(String),
  })
  return error
}
export async function stopAndWait(page: Page, node: { sessionId?: string | null }) {
  await invoke(page, 'session.kill', { sessionId: node.sessionId })
  await expect
    .poll(
      async () =>
        (
          await invoke<{ sessions: { sessionId: string; status: string }[] }>(
            page,
            'session.list',
            null,
            'query',
          )
        ).sessions.find(s => s.sessionId === node.sessionId)?.status,
      { timeout: 20_000 },
    )
    .toBe('exited')
}
