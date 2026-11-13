import { expect, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
  type SeedNode,
} from './workspace-canvas.helpers'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'

export const projectId = 'prompt-project'
export const spaceId = 'prompt-space'
export async function promptApp(nodes: SeedNode[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-initial-prompt-'))
  const workspace = join(root, 'project')
  await mkdir(workspace)
  let closeApp = async () => {}
  let launched: Awaited<ReturnType<typeof launchApp>>
  try {
    launched = await launchApp({
      userDataDir: join(root, 'profile'),
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'initial-prompt-argv',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
      },
    })
    closeApp = () => launched.electronApp.close()
    await seedWorkspaceState(launched.window, {
      activeWorkspaceId: projectId,
      settings: { defaultProvider: 'pi', agentFullAccess: true },
      workspaces: [
        {
          id: projectId,
          name: 'Initial prompts',
          path: workspace,
          activeSpaceId: spaceId,
          nodes,
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: nodes.map(node => node.id),
              rect: { x: 0, y: 0, width: 1600, height: 1000 },
            },
          ],
        },
      ],
    })
  } catch (error) {
    await closeApp()
    await removePathWithRetry(root)
    throw error
  }
  return {
    ...launched,
    workspace,
    records: () => records(workspace),
    close: async () => {
      try {
        await launched.electronApp.close()
      } finally {
        await removePathWithRetry(root)
      }
    },
  }
}
export async function records(workspace: string): Promise<
  Array<{
    provider: string
    prompt?: string
    command?: string
    args: string[]
    raw?: string[]
    connect?: string
  }>
> {
  const text = await readFile(join(workspace, 'initial-prompt-argv.jsonl'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  })
  return text.trim()
    ? text
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
    : []
}
export async function createCliTerminal(page: Page) {
  const created = await page.evaluate(
    async space =>
      window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
        kind: 'command',
        id: 'node.create',
        payload: {
          kind: 'terminal',
          space: { kind: 'spaceId', spaceId: space },
          frame: { x: 100, y: 100, width: 1000, height: 600 },
          data: { shell: navigator.platform.startsWith('Win') ? 'powershell.exe' : '/bin/sh' },
        },
      }),
    spaceId,
  )
  const binding = { nodeId: created.node.id, sessionId: created.node.sessionId! }
  expect(binding.sessionId).toBeTruthy()
  await expect(
    page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`),
  ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
  return binding
}
