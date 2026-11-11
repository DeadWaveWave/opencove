import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../src/shared/contracts/controlSurface'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type {
  CreateNodeResult,
  GetNodeResult,
  PrepareOrReviveSessionResult,
} from '../../src/shared/contracts/dto'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
} from './workspace-canvas.helpers'
import { waitForControlSurfaceConnection } from './controlSurfaceConnection.helpers'
import { startWorker, stopWorker } from './worker-client.helpers'
import {
  createCliAgent,
  projectId,
  spaceId,
} from './recovery.managed-claude-launch-lifecycle.helpers'

export async function defaultsHarness(
  scenario: 'claude-clear-ordering' | 'claude-session-ownership',
) {
  const userDataDir = await createTestUserDataDir()
  const home = path.join(userDataDir, 'home'),
    workspace = path.join(userDataDir, 'workspace')
  const profile = path.join(home, 'empty-profile'),
    logPath = path.join(userDataDir, 'provider.jsonl')
  await mkdir(path.join(home, '.claude'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await mkdir(path.join(userDataDir, 'runtime'), { recursive: true, mode: 0o700 })
  await writeFile(profile, '')
  const env = {
    NODE_ENV: 'test',
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    ZDOTDIR: home,
    BASH_ENV: profile,
    ENV: profile,
    XDG_RUNTIME_DIR: path.join(userDataDir, 'runtime'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    OPENCOVE_WORKER_CLIENT: '1',
    OPENCOVE_TEST_WORKSPACE: workspace,
    OPENCOVE_TEST_USE_REAL_AGENTS: '0',
    OPENCOVE_TEST_ENABLE_MANAGED_CLAUDE_REBIND: '1',
    OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
    OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
    OPENCOVE_TEST_AGENT_SESSION_SCENARIO: scenario,
    OPENCOVE_TEST_AGENT_STUB_SCRIPT: path.join(__dirname, `fixtures/${scenario}.mjs`),
    OPENCOVE_TEST_CLAUDE_OWNERSHIP_LOG: logPath,
    OPENCOVE_TEST_CLEAR_LOG: logPath,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    CLAUDE_CODE_OAUTH_TOKEN: '',
    ...(process.platform === 'win32' ? {} : { SHELL: '/bin/bash' }),
  }
  let worker: ChildProcessWithoutNullStreams | null = null,
    app: ElectronApplication | undefined
  let page!: Page
  const stop = async () => {
    await app?.close()
    app = undefined
    await stopWorker(worker)
    worker = null
  }
  let coldReceipt: PrepareOrReviveSessionResult | undefined
  const start = async (frozen = false, prepareNodeId?: string) => {
    await stop()
    const configured = frozen ? { ...env, OPENCOVE_MANAGED_CLAUDE_BINDINGS: '0' } : env
    worker = (await startWorker({ userDataDir, env: configured })).child
    worker.stdout.resume()
    worker.stderr.resume()
    if (prepareNodeId) {
      const connection = await waitForControlSurfaceConnection(userDataDir)
      const response = await fetch(`${connection.endpoint}/invoke`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${connection.token}`,
          'content-type': 'application/json',
          'x-opencove-protocol': String(CONTROL_SURFACE_PROTOCOL_VERSION),
        },
        body: JSON.stringify({
          kind: 'command',
          id: 'session.prepareOrRevive',
          clientFeatures: { managedClaudeResumeBindingV1: true },
          payload: { workspaceId: projectId, nodeIds: [prepareNodeId] },
        }),
      })
      const envelope = await response.json()
      expect(envelope.ok).toBe(true)
      coldReceipt = envelope.value
    }
    const launched = await launchApp({ userDataDir, cleanupUserDataDir: false, env: configured })
    app = launched.electronApp
    page = launched.window
    return page
  }
  const seed = async () =>
    seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      settings: { language: 'en', defaultProvider: 'claude-code', agentFullAccess: false },
      workspaces: [
        {
          id: projectId,
          name: 'Managed recovery',
          path: workspace,
          activeSpaceId: spaceId,
          nodes: [],
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 5000, height: 3000 },
            },
          ],
        },
      ],
    })
  const createAgent = async () => {
    const terminal = await page.evaluate(
      async target =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: target },
            data: { shell: navigator.platform.includes('Win') ? 'powershell.exe' : '/bin/sh' },
          },
        }),
      spaceId,
    )
    await expect(
      page.locator(`[data-id="${terminal.node.id}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
    return createCliAgent(page, { nodeId: terminal.node.id, sessionId: terminal.node.sessionId! })
  }
  const readNode = (id: string) =>
    page.evaluate(
      async nodeId =>
        window.opencoveApi.controlSurface.invoke<GetNodeResult>({
          kind: 'query',
          id: 'node.get',
          payload: { nodeId },
        }),
      id,
    )
  const persistedNode = (id: string) =>
    page.evaluate(async nodeId => {
      const state = (await window.opencoveApi.persistence.readAppState()).state as {
        workspaces: Array<{
          nodes: Array<{
            id: string
            workerBinding: unknown
            agent: {
              resumeSessionId: string
              resumeSessionIdVerified: boolean
              executionDirectory: string
            }
          }>
        }>
      }
      return state.workspaces.flatMap(w => w.nodes).find(n => n.id === nodeId)!
    }, id)
  const records = async (): Promise<
    Array<{ mode?: string; sessionId?: string; id?: string; scenario?: string; cwd?: string }>
  > =>
    (await readFile(logPath, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
  const capabilities = () =>
    page.evaluate(async () =>
      window.opencoveApi.controlSurface.invoke<{ features: Record<string, boolean> }>({
        kind: 'query',
        id: 'system.capabilities',
        payload: {},
      }),
    )
  return {
    userDataDir,
    home,
    workspace,
    start,
    seed,
    createAgent,
    readNode,
    persistedNode,
    records,
    capabilities,
    getColdReceipt: () => coldReceipt,
    close: async () => {
      try {
        await stop()
      } finally {
        await removePathWithRetry(userDataDir)
      }
    },
  }
}
