import { shellWord } from '../../src/app/cli/core/shellWord'
import { expect, type Page } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import {
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
  type SeedWorkspace,
} from './workspace-canvas.helpers'

export const spaceComparisonCommand = `opencove space get --space ${shellWord('@self')} --fields id,name,directoryPath,boundary,nodeIds,nodeCount,projectId,nodes`

export const projectId = 'cli-output-project'
export const spaceId = 'cli-output-space'
export type Binding = { nodeId: string; sessionId: string }

export async function createOutputTerminal(
  page: Page,
  nodeKind: 'agent' | 'terminal' = 'terminal',
): Promise<Binding> {
  const result = await page.evaluate(
    async ({ kind, targetSpaceId, shell }) => {
      return window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
        kind: 'command',
        id: 'node.create',
        payload: {
          kind,
          space: { kind: 'spaceId', spaceId: targetSpaceId },
          title: kind === 'agent' ? 'Reader' : 'Shell',
          frame: { x: kind === 'agent' ? 850 : 20, y: 20, width: 760, height: 540 },
          data: kind === 'agent' ? { provider: 'codex', prompt: '' } : { shell },
        },
      })
    },
    {
      kind: nodeKind,
      targetSpaceId: spaceId,
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
    },
  )
  if (!result.node.sessionId) {
    throw new Error('Created node has no PTY session')
  }
  await page.evaluate(async nodeId => {
    await window.opencoveApi.controlSurface.invoke({
      kind: 'command',
      id: 'canvas.focus',
      payload: { target: { kind: 'node', nodeId } },
    })
  }, result.node.id)
  await expect(
    page.locator(`[data-id="${result.node.id}"] .terminal-node__terminal`),
  ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
  return { nodeId: result.node.id, sessionId: result.node.sessionId }
}

export async function withOutputWorkspace(
  nodes: SeedWorkspace['nodes'],
  execute: (page: Page, shell: Binding) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-output-'))
  const workspace = join(root, 'project'),
    profile = join(root, 'profile')
  let app: Awaited<ReturnType<typeof launchApp>>['electronApp'] | undefined
  try {
    await mkdir(workspace)
    const launched = await launchApp({
      userDataDir: profile,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'stdin-echo',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
        CODEX_HOME: join(profile, 'home', '.codex'),
        CLAUDE_CONFIG_DIR: join(profile, 'home', '.claude'),
      },
    })
    app = launched.electronApp
    await seedWorkspaceState(launched.window, {
      activeWorkspaceId: projectId,
      workspaces: [
        {
          id: projectId,
          name: 'CLI output',
          path: workspace,
          activeSpaceId: spaceId,
          nodes,
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: nodes.map(n => n.id),
              rect: { x: 0, y: 0, width: 8000, height: 8000 },
            },
          ],
        },
      ],
    })
    await execute(launched.window, await createOutputTerminal(launched.window))
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
}
