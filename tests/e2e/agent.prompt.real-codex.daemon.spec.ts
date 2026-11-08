import { AcceptanceFailures } from './agent.prompt.real-codex.daemon.failures'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type ElectronApplication } from '@playwright/test'
import type { AgentRunSnapshot } from '../../src/shared/contracts/dto/agentRunState'
import {
  assertAgentProcessesGone,
  endAgentNode,
  snapshotAgentProcesses,
  socketReachable,
  startSlowTool,
  slowToolSeconds,
} from './agent.prompt.real-codex.daemon.helpers'
import { cli, prompt, startResponsesApi, writeCodexConfig } from './agent.prompt.real-codex.helpers'
import { launchApp, seedWorkspaceState } from './workspace-canvas.helpers'
import { resolveFirstAgentSessionId } from './workspace-canvas.agent-status-watcher.helpers'

const exec = promisify(execFile)

test.describe('Codex orchestration beside a shared app-server daemon', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Codex CLI')
  test.skip(process.platform === 'win32', 'Codex lifecycle hooks are not used on Windows')

  for (const reuse of [false, true]) {
    for (const ending of ['close', 'delete'] as const) {
      test(`${reuse ? 'opt-in reuse skips hooks and refuses prompts' : 'default hooks complete prompts while the daemon stays healthy'}; ${ending} reaps the agent tree`, async ({
        browserName: _browserName,
      }, testInfo) => {
        test.setTimeout(180_000)
        // Keep the Unix socket below macOS sun_path limits, independently of its long tmpdir().
        const root = await realpath(await mkdtemp('/tmp/oc-daemon-'))
        const codexHome = join(root, 'codex')
        const workspace = join(root, 'workspace')
        const userDataDir = join(root, 'user-data')
        const api = await startResponsesApi({ slowToolSeconds })
        let app: ElectronApplication | undefined
        const environment = {
          ...process.env,
          CODEX_HOME: codexHome,
          OPENCOVE_TEST_MOCK_API_KEY: 'opencove-local-diagnostic-not-a-real-key',
        }
        const daemon = async (operation: 'start' | 'stop' | 'version') => {
          const result = await exec('codex', ['app-server', 'daemon', operation], {
            env: environment,
            cwd: workspace,
            timeout: 45_000,
          })
          await testInfo.attach(`daemon-${operation}`, {
            body: result.stdout,
            contentType: 'application/json',
          })
          return JSON.parse(result.stdout) as {
            status: string
            appServerVersion?: string
            pid?: number
          }
        }
        const failures = new AcceptanceFailures()
        await failures.capture('acceptance', async () => {
          await mkdir(workspace)
          await mkdir(codexHome)
          await writeCodexConfig(codexHome, workspace, api.url)
          await mkdir(join(codexHome, 'app-server-daemon'))
          await writeFile(
            join(codexHome, 'app-server-daemon', 'settings.json'),
            JSON.stringify({
              remoteControlEnabled: false,
              shutdownGraceSeconds: 0,
              updater: { autoUpdateEnabled: false },
            }),
          )
          // Every Codex invocation, including lifecycle commands, uses only this disposable home.
          // Only `daemon start` reports the daemon pid; `daemon version` omits it.
          const started = await daemon('start')
          const socketPath = join(codexHome, 'app-server-control', 'app-server-control.sock')
          await expect.poll(() => socketReachable(socketPath), { timeout: 10_000 }).toBe(true)
          expect(await daemon('version')).toMatchObject({
            status: 'running',
            appServerVersion: expect.any(String),
          })

          const { electronApp, window: page } = await launchApp({
            userDataDir,
            cleanupUserDataDir: false,
            env: {
              CODEX_HOME: codexHome,
              OPENCOVE_TEST_MOCK_API_KEY: environment.OPENCOVE_TEST_MOCK_API_KEY,
              OPENCOVE_TEST_USE_REAL_AGENTS: '1',
              OPENCOVE_TEST_CODEX_HOOK_INSTALL_FAILURE: '0',
            },
          })
          app = electronApp
          await seedWorkspaceState(page, {
            activeWorkspaceId: 'codex-daemon',
            settings: {
              defaultProvider: 'codex',
              agentFullAccess: false,
              customModelEnabledByProvider: { codex: false },
              // Omit the field in the default case to exercise persisted-setting compatibility.
              ...(reuse ? { codexReuseRunningAppServer: true } : {}),
            },
            workspaces: [
              {
                id: 'codex-daemon',
                name: 'Codex daemon',
                path: workspace,
                nodes: [
                  {
                    id: 'codex-task',
                    title: 'Codex task',
                    kind: 'task',
                    status: null,
                    position: { x: 100, y: 80 },
                    width: 460,
                    height: 280,
                    task: {
                      requirement: 'Reply with ACK.',
                      status: 'todo',
                      linkedAgentNodeId: null,
                      lastRunAt: null,
                      autoGeneratedTitle: false,
                    },
                  },
                ],
              },
            ],
          })
          await page.locator('[data-testid="task-node-run-agent"]').click()
          await expect
            .poll(() => resolveFirstAgentSessionId(page), { timeout: 30_000 })
            .not.toBeNull()
          const sessionId = (await resolveFirstAgentSessionId(page))!
          const snapshot = () =>
            page.evaluate(
              id =>
                window.opencoveApi.controlSurface.invoke<AgentRunSnapshot>({
                  kind: 'query',
                  id: 'agent.get',
                  payload: { sessionId: id },
                }),
              sessionId,
            )
          // Hook installation shows in behavior: hook-driven idle state and accepted prompts
          // with the default setting; a degraded state and refused prompts when reusing the daemon.
          if (reuse) {
            // Require a real launch request before checking the degraded fallback.
            await expect.poll(() => api.main().length, { timeout: 60_000 }).toBe(1)
            await expect
              .poll(async () => (await snapshot()).quality, { timeout: 30_000 })
              .toBe('degraded')
            const nodeId = (await snapshot()).nodeId!
            const refused = await prompt(userDataDir, nodeId, 'MUST_NOT_ARRIVE')
            expect(refused.exitCode, JSON.stringify(refused)).toBe(1)
            expect(refused.stderr).toContain('agent.prompt_unsupported')
            expect(refused.stderr).toContain('codex_hooks_skipped')
            expect(api.main()).toHaveLength(1)
            expect((await snapshot()).source).not.toBe('codex_hook')
          } else {
            await expect
              .poll(
                async () => {
                  const value = await snapshot()
                  return `${value.state}:${value.source}`
                },
                { timeout: 60_000 },
              )
              .toBe('idle:codex_hook')
            const nodeId = (await snapshot()).nodeId!
            const text = 'DAEMON_COEXISTENCE: reply with ACK.'
            const delivered = await prompt(userDataDir, nodeId, text)
            expect(delivered.exitCode, JSON.stringify(delivered)).toBe(0)
            expect(JSON.parse(delivered.stdout)).toMatchObject({ phase: 'submission_observed' })
            const turnId = JSON.parse(delivered.stdout).turnId as string
            expect(turnId).toBeTruthy()
            const waited = await cli(userDataDir, [
              'agent',
              'wait',
              '--node',
              nodeId,
              '--turn',
              turnId,
              '--timeout',
              '30s',
            ])
            expect(waited.exitCode, JSON.stringify(waited)).toBe(0)
            expect(JSON.parse(waited.stdout)).toMatchObject({
              nodeId,
              turnId,
              outcome: 'completed',
            })
            expect(api.main().at(-1)).toContain(text)
          }
          // Inspect the actual rendered terminal buffer, including errors that have scrolled away.
          const nodeId = (await snapshot()).nodeId!
          const screen = await cli(userDataDir, [
            'agent',
            'read',
            '--node',
            nodeId,
            '--screen',
            '--lines',
            '200',
            '-o',
            'json',
          ])
          expect(screen.exitCode, JSON.stringify(screen)).toBe(0)
          expect(screen.stdout).not.toMatch(
            /database (?:is )?locked|sqlite_busy|error opening|failed to (?:start|connect)/iu,
          )
          await testInfo.attach('codex-screen', {
            body: screen.stdout,
            contentType: 'application/json',
          })
          await testInfo.attach('codex-tui', {
            body: await page.screenshot(),
            contentType: 'image/png',
          })
          expect(await daemon('version')).toMatchObject({
            status: 'running',
            appServerVersion: expect.any(String),
          })
          expect(await socketReachable(socketPath)).toBe(true)
          expect(await daemon('version')).toMatchObject({ status: 'running' })
          await startSlowTool(page, nodeId)
          const processes = await snapshotAgentProcesses({
            requireToolChild: !reuse,
            sessionId,
            daemonPid: started.pid,
            codexHome,
            workspace,
            testInfo,
          })
          await failures.capture('node cleanup', async () => {
            await endAgentNode(page, userDataDir, nodeId, ending)
            await assertAgentProcessesGone(processes, testInfo)
            await expect(page.locator(`.react-flow__node[data-id="${nodeId}"]`)).toHaveCount(0)
          })
          await failures.capture('daemon health after node cleanup', async () => {
            // Check even when cleanup fails; stopping an Agent must never restart/kill the daemon.
            // `daemon version` omits the pid, so prove the same daemon process is still alive.
            expect(await daemon('version')).toMatchObject({
              status: 'running',
              appServerVersion: expect.any(String),
            })
            expect(() => process.kill(processes.daemonPid, 0)).not.toThrow()
            expect(await socketReachable(socketPath)).toBe(true)
          })
        })
        await failures.capture('app close', async () => await app?.close())
        await failures.capture('daemon stop', async () => await daemon('stop'))
        await failures.capture('mock API close', async () => {
          api.server.closeAllConnections()
          await new Promise<void>((resolve, reject) =>
            api.server.close(error => (error ? reject(error) : resolve())),
          )
        })
        await failures.capture(
          'temporary directory removal',
          // A stopped daemon's plugin-sync git child can keep writing into the disposable
          // CODEX_HOME for a few seconds after `daemon stop` (Codex behavior, not OpenCove's).
          async () =>
            await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }),
        )
        failures.throwIfAny()
      })
    }
  }
})
