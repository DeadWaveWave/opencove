import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { initialAgentWaitStub as stub } from '../support/initialAgentWaitStub'

// UI readiness stays in Desktop; the four real hook/CLI outcomes live in worker-cli contracts.
test('Desktop projects the granted coordinator terminal before agent commands', async () => {
  test.setTimeout(90_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-create-wait-'))
  const workspace = join(root, 'project'),
    profile = join(root, 'profile')
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const script = join(root, 'initial-agent.mjs')
    await writeFile(script, stub)
    const launched = await launchApp({
      userDataDir: profile,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: script,
        // This existing scenario forwards real launch arguments to the test stub.
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-prompt-strict',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_TEST_CODEX_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: 'create-wait-project',
      settings: { agentFullAccess: false, codexReuseRunningAppServer: false },
      workspaces: [
        {
          id: 'create-wait-project',
          name: 'Create wait project',
          path: workspace,
          activeSpaceId: null,
          nodes: [],
          spaces: [],
        },
      ],
    })
    const shell = await page.evaluate(
      async payload =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            projectId: 'create-wait-project',
            title: 'Coordinator shell',
            data: { shell: payload },
          },
        }),
      process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
    )
    const binding = { nodeId: shell.node.id, sessionId: shell.node.sessionId! }
    expect(binding.sessionId).toBeTruthy()
    await expect(
      page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
