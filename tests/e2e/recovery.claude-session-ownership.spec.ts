import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
} from './workspace-canvas.helpers'
import { readRuntimeSessionId } from './workspace-canvas.terminal-agent-overlay.helpers'
import { startWorker, stopWorker } from './worker-client.helpers'

interface Binding {
  taskId: string
  nodeId: string | null
  sessionId: string | null
  verified: boolean
  cwd: string | null
}

interface Invocation {
  mode: string
  sessionId: string
  cwd: string
  pid: number
}

async function readBindings(window: Page): Promise<Binding[]> {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = JSON.parse(raw ?? '{}') as {
      workspaces?: Array<{
        nodes?: Array<{
          id: string
          kind: string
          task?: { linkedAgentNodeId?: string | null }
          agent?: {
            resumeSessionId?: string | null
            resumeSessionIdVerified?: boolean
            executionDirectory?: string | null
          }
        }>
      }>
    }
    const nodes = state.workspaces?.[0]?.nodes ?? []
    return nodes
      .filter(node => node.kind === 'task')
      .map(task => {
        const nodeId = task.task?.linkedAgentNodeId ?? null
        const agent = nodes.find(node => node.id === nodeId && node.kind === 'agent')?.agent
        return {
          taskId: task.id,
          nodeId,
          sessionId: agent?.resumeSessionId ?? null,
          verified: agent?.resumeSessionIdVerified === true,
          cwd: agent?.executionDirectory ?? null,
        }
      })
      .sort((a, b) => a.taskId.localeCompare(b.taskId))
  })
}

async function readInvocations(logPath: string): Promise<Invocation[]> {
  return (await readFile(logPath, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Invocation)
}

async function expectOwnedSessions(window: Page, bindings: Binding[], mode: string): Promise<void> {
  await expect(window.locator('.terminal-node')).toHaveCount(2)
  for (const binding of bindings) {
    const terminal = window.locator(`[data-id="${binding.nodeId}"] .terminal-node`)
    // eslint-disable-next-line no-await-in-loop -- two independent nodes must both finish recovery
    await expect(terminal).toContainText(`[opencove-test-claude-ownership] ${mode}`)
    // eslint-disable-next-line no-await-in-loop -- keep the complete provider ID assertion exact
    await expect(terminal).toContainText(binding.sessionId!)
    // eslint-disable-next-line no-await-in-loop -- exercise the normally enabled hook channel
    await expect(terminal).toHaveAttribute('data-agent-hook-install-state', 'installed')
    // eslint-disable-next-line no-await-in-loop -- fixture Stop events use the real hook channel
    await expect(terminal).toHaveAttribute('data-agent-state-source', 'claude_hook')
    // eslint-disable-next-line no-await-in-loop -- assert each recovered node has a live PTY
    await expect.poll(() => readRuntimeSessionId(window, binding.nodeId!)).not.toBeNull()
    // eslint-disable-next-line no-await-in-loop -- each node must settle on its own hook/session data
    await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
  }
}

test.describe('Recovery - Claude managed session ownership', () => {
  test('keeps same-directory agents distinct across an app and worker cold restart', async ({
    browserName: _browserName,
  }, testInfo) => {
    // This is an artificial provider E2E: actual Electron/worker/persistence, no Claude model calls.
    const userDataDir = await createTestUserDataDir()
    const home = path.join(userDataDir, 'home')
    const workspace = path.join(userDataDir, 'workspace')
    const logPath = path.join(userDataDir, 'provider-invocations.jsonl')
    const profile = path.join(home, 'empty-profile')
    const runtimeDirectory = path.join(userDataDir, 'runtime')
    await mkdir(workspace, { recursive: true })
    await mkdir(path.join(home, '.claude'), { recursive: true })
    await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 })
    await writeFile(profile, '')
    const env = {
      NODE_ENV: 'test',
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      ZDOTDIR: home,
      BASH_ENV: profile,
      ENV: profile,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      XDG_RUNTIME_DIR: runtimeDirectory,
      OPENCOVE_TEST_WORKSPACE: workspace,
      OPENCOVE_WORKER_CLIENT: '1',
      OPENCOVE_TEST_USE_REAL_AGENTS: '0',
      OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
      OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
      OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-session-ownership',
      OPENCOVE_TEST_AGENT_STUB_SCRIPT: path.join(
        __dirname,
        'fixtures/claude-session-ownership.mjs',
      ),
      OPENCOVE_TEST_CLAUDE_OWNERSHIP_LOG: logPath,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      ...(process.platform === 'win32' ? {} : { SHELL: '/bin/bash' }),
    }
    let workerChild: ChildProcessWithoutNullStreams | null = null
    let initialBindings: Binding[] = []
    let initialRuntimeIds: Array<string | null> = []

    try {
      workerChild = (await startWorker({ userDataDir, env })).child
      workerChild.stdout.resume()
      workerChild.stderr.resume()
      const firstWorkerPid = workerChild.pid
      const { electronApp, window } = await launchApp({
        userDataDir,
        cleanupUserDataDir: false,
        env,
      })
      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: 'claude-ownership',
          settings: {
            defaultProvider: 'claude-code',
            agentFullAccess: false,
            customModelEnabledByProvider: { 'claude-code': false },
            customModelByProvider: { 'claude-code': '' },
            customModelOptionsByProvider: { 'claude-code': [] },
          },
          workspaces: [
            {
              id: 'claude-ownership',
              name: 'Claude ownership regression',
              path: workspace,
              nodes: ['a', 'b'].map((label, index) => ({
                id: `ownership-task-${label}`,
                title: `Ownership task ${label}`,
                kind: 'task' as const,
                position: { x: 120 + index * 360, y: 120 },
                width: 320,
                height: 220,
                task: {
                  requirement: `Artificial fixture ${label}; no model calls`,
                  status: 'todo' as const,
                  linkedAgentNodeId: null,
                  lastRunAt: null,
                  autoGeneratedTitle: false,
                },
              })),
            },
          ],
        })
        for (const label of ['a', 'b']) {
          // eslint-disable-next-line no-await-in-loop -- deterministic UI creation of the two agents
          await window
            .locator(`[data-id="ownership-task-${label}"]`)
            .getByTestId('task-node-run-agent')
            .evaluate(element => (element as HTMLElement).click())
        }
        await expect
          .poll(() => readBindings(window))
          .toEqual(
            ['a', 'b'].map(label => ({
              taskId: `ownership-task-${label}`,
              nodeId: expect.any(String),
              sessionId: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
              ),
              verified: true,
              cwd: workspace,
            })),
          )
        initialBindings = await readBindings(window)
        expect(new Set(initialBindings.map(binding => binding.sessionId)).size).toBe(2)
        await expectOwnedSessions(window, initialBindings, 'new')
        initialRuntimeIds = await Promise.all(
          initialBindings.map(binding => readRuntimeSessionId(window, binding.nodeId!)),
        )
      } finally {
        await electronApp.close()
      }
      await stopWorker(workerChild)
      expect(workerChild.exitCode !== null || workerChild.signalCode !== null).toBe(true)
      workerChild = null

      // A newer unrelated transcript must never replace either durable node-owned identity.
      const unrelatedSessionId = randomUUID()
      const projectDirectory = path.join(
        home,
        '.claude/projects',
        path.resolve(workspace).replace(/[^A-Za-z0-9]/gu, '-'),
      )
      const unrelatedPath = path.join(projectDirectory, `${unrelatedSessionId}.jsonl`)
      await writeFile(
        unrelatedPath,
        `${JSON.stringify({
          type: 'assistant',
          sessionId: unrelatedSessionId,
          cwd: workspace,
          message: {
            content: [{ type: 'text', text: 'Unrelated synthetic session C' }],
            stop_reason: 'end_turn',
          },
        })}\n`,
      )
      const newest = new Date(Date.now() + 60_000)
      await utimes(unrelatedPath, newest, newest)

      workerChild = (await startWorker({ userDataDir, env })).child
      workerChild.stdout.resume()
      workerChild.stderr.resume()
      expect(workerChild.pid).not.toBe(firstWorkerPid)
      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        userDataDir,
        cleanupUserDataDir: false,
        env,
      })
      try {
        await expectOwnedSessions(restartedWindow, initialBindings, 'resume')
        await expect.poll(() => readBindings(restartedWindow)).toEqual(initialBindings)
        const restartedRuntimeIds = await Promise.all(
          initialBindings.map(binding => readRuntimeSessionId(restartedWindow, binding.nodeId!)),
        )
        expect(restartedRuntimeIds.every(id => id && !initialRuntimeIds.includes(id))).toBe(true)
        await expect
          .poll(async () => (await readInvocations(logPath)).filter(item => item.mode === 'resume'))
          .toHaveLength(2)
        const invocations = await readInvocations(logPath)
        for (const mode of ['new', 'resume']) {
          expect(
            invocations
              .filter(item => item.mode === mode)
              .map(item => item.sessionId)
              .sort(),
          ).toEqual(initialBindings.map(binding => binding.sessionId).sort())
        }
        expect(invocations.some(item => item.sessionId === unrelatedSessionId)).toBe(false)
        await testInfo.attach('claude-session-ownership', {
          body: Buffer.from(JSON.stringify({ initialBindings, unrelatedSessionId, invocations })),
          contentType: 'application/json',
        })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await stopWorker(workerChild)
      await removePathWithRetry(userDataDir)
    }
  })
})
