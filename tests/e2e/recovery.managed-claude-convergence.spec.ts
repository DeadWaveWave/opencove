import {
  syntheticRebind,
  expectConversation,
  holdPrepare,
  releasePrepare,
} from './managedClaudeContinuity.helpers'
/* eslint-disable no-await-in-loop -- Ordered persistence repair and lifecycle transitions must run sequentially. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  chromium,
  expect,
  test,
  type ElectronApplication,
  type BrowserContext,
} from '@playwright/test'
import { staleManagedPublication } from '../support/convergence/staleManagedPublication'
import type { CreateNodeResult } from '../../src/shared/contracts/dto'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
} from './workspace-canvas.helpers'
import { startWorker, stopWorker } from './worker-client.helpers'
import { waitForControlSurfaceConnection } from './controlSurfaceConnection.helpers'
import {
  createCliAgent,
  getBinding,
  launch,
  projectId,
  spaceId,
} from './recovery.managed-claude-launch-lifecycle.helpers'

test('managed Claude stale publications retain layout and cold-resume the current conversation', async () => {
  test.setTimeout(180_000)
  const userDataDir = await createTestUserDataDir()
  const home = path.join(userDataDir, 'home'),
    workspace = path.join(userDataDir, 'workspace')
  const profile = path.join(home, 'empty-profile'),
    logPath = path.join(userDataDir, 'invocations.jsonl')
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
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_RUNTIME_DIR: path.join(userDataDir, 'runtime'),
    OPENCOVE_TEST_WORKSPACE: workspace,
    OPENCOVE_WORKER_CLIENT: '1',
    OPENCOVE_TEST_USE_REAL_AGENTS: '0',
    OPENCOVE_EXPERIMENTAL_MANAGED_CLAUDE_BINDINGS: '1',
    OPENCOVE_TEST_ENABLE_MANAGED_CLAUDE_REBIND: '1',
    OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
    OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
    OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-session-ownership',
    OPENCOVE_TEST_AGENT_STUB_SCRIPT: path.join(__dirname, 'fixtures/claude-session-ownership.mjs'),
    OPENCOVE_TEST_CLAUDE_OWNERSHIP_LOG: logPath,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    CLAUDE_CODE_OAUTH_TOKEN: '',
    ...(process.platform === 'win32' ? {} : { SHELL: '/bin/bash' }),
  }
  let worker: ChildProcessWithoutNullStreams | null = null
  let app: ElectronApplication | undefined
  let webContext: BrowserContext | undefined
  const browser = await chromium.launch({ headless: true })
  try {
    worker = (await startWorker({ userDataDir, env })).child
    worker.stdout.resume()
    worker.stderr.resume()
    const first = await launchApp({ userDataDir, cleanupUserDataDir: false, env })
    app = first.electronApp
    let page = first.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      settings: { defaultProvider: 'claude-code', agentFullAccess: false },
      workspaces: [
        {
          id: projectId,
          name: 'Convergence',
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
    const terminal = await page.evaluate(
      async targetSpaceId =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: targetSpaceId },
            data: { shell: navigator.platform.includes('Win') ? 'powershell.exe' : '/bin/sh' },
          },
        }),
      spaceId,
    )
    const cliBinding = { nodeId: terminal.node.id, sessionId: terminal.node.sessionId! }
    await expect(
      page.locator(`[data-id="${cliBinding.nodeId}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
    const agent = await createCliAgent(page, cliBinding)
    const created = await getBinding(page, agent.id)
    const replacement = await launch(page, agent.id, workspace, {
      kind: 'launchNew',
      expected: { activationId: created.activationId, tuple: created.tuple },
    })
    const launched = replacement.managedClaudeLifecycle!.binding
    expect(launched.tuple.resumeSessionId).not.toBe(created.tuple.resumeSessionId)
    await expect
      .poll(async () => (await getBinding(page, agent.id)).tuple)
      .toEqual({ resumeSessionId: launched.tuple.resumeSessionId, resumeSessionIdVerified: true })
    const initial = await getBinding(page, agent.id)
    await expectConversation(page, agent.id, initial.tuple.resumeSessionId!)
    const connection = await waitForControlSurfaceConnection(userDataDir)
    const webUrl = new URL(connection.endpoint)
    webUrl.searchParams.set('token', connection.token)
    const workerPort = Number(webUrl.port || 80)
    webContext = await browser.newContext()
    await webContext.tracing.start({ screenshots: true, snapshots: true, sources: true })
    const web = await webContext.newPage()
    await holdPrepare(web, agent.id)
    await web.goto(webUrl.toString(), { waitUntil: 'domcontentloaded' })
    await web.waitForFunction(() =>
      Boolean((window as unknown as { __heldManagedPrepare?: unknown }).__heldManagedPrepare),
    )
    const held = await web.evaluate(
      () => (window as unknown as { __heldManagedPrepare?: unknown }).__heldManagedPrepare,
    )
    expect(held).toMatchObject({
      nodeId: agent.id,
      managedClaudeBinding: {
        activationId: initial.activationId,
        runtimeSessionId: initial.runtimeSessionId,
        tuple: initial.tuple,
      },
    })
    await web.evaluate(() => Object.assign(window, { __dropManagedSync: true }))
    const nextId = await syntheticRebind(
      userDataDir,
      home,
      workspace,
      agent.id,
      initial.tuple.resumeSessionId!,
    )
    const current = await getBinding(page, agent.id)
    expect(current.tuple.resumeSessionId).toBe(nextId)
    expect(current.runtimeSessionId).toBe(initial.runtimeSessionId)
    await releasePrepare(web)
    await expectConversation(web, agent.id, initial.tuple.resumeSessionId!)
    await expectConversation(page, agent.id, nextId)
    // A real UI layout publication must converge from its corrected or merged response alone.
    await web.locator('.react-flow__controls-fitview').click()
    const header = web.locator(`[data-id="${agent.id}"] .terminal-node__header`)
    const box = await header.boundingBox()
    expect(box).toBeTruthy()
    await web.mouse.move(box!.x + 70, box!.y + 16)
    await web.mouse.down()
    await web.mouse.move(box!.x + 130, box!.y + 56, { steps: 15 })
    await web.mouse.up()
    await web.waitForFunction(() =>
      Boolean((window as unknown as { __correctedManagedWrite?: boolean }).__correctedManagedWrite),
    )
    await expectConversation(web, agent.id, nextId)
    await web.evaluate(() => Object.assign(window, { __dropManagedSync: false }))
    const expectedTuple = { resumeSessionId: nextId, resumeSessionIdVerified: true }
    for (const raw of [false, true]) {
      // Hook attestation can advance the binding after launch. Capture the committed node,
      // then inject a tuple that has never been admitted instead of assuming an old read is stale.
      let latest!: { state: unknown; revision: number | null }
      await expect
        .poll(async () => {
          latest = await page.evaluate(async () => window.opencoveApi.persistence.readAppState())
          try {
            const probe = staleManagedPublication(latest.state, agent.id, raw ? 1300 : 1200)
            return { activationId: probe.activationId, tuple: probe.canonicalTuple }
          } catch {
            return null
          }
        })
        .toEqual({ activationId: current.activationId, tuple: expectedTuple })
      const proposed = staleManagedPublication(latest.state, agent.id, raw ? 1300 : 1200)
      expect(proposed.submittedTuple.resumeSessionId).not.toBe(
        proposed.canonicalTuple.resumeSessionId,
      )
      const result = await page.evaluate(
        async ({ candidate, baseRevision, rawWrite }) =>
          rawWrite
            ? window.opencoveApi.persistence.writeWorkspaceStateRaw({
                raw: JSON.stringify(candidate),
              })
            : window.opencoveApi.persistence.writeAppState({ state: candidate, baseRevision }),
        { candidate: proposed.candidate, baseRevision: latest.revision, rawWrite: raw },
      )
      const receiptDetails = JSON.stringify({
        route: raw ? 'raw' : 'structured',
        baseRevision: latest.revision,
        activationId: proposed.activationId,
        canonicalTuple: proposed.canonicalTuple,
        submittedTuple: proposed.submittedTuple,
        result,
      })
      expect(result, receiptDetails).toMatchObject({ ok: true })
      if (raw) {
        // Raw replacements bypass adapter rebasing; the SQLite gate must report correction.
        expect(result, receiptDetails).toMatchObject({ corrected: true })
      } else {
        // CAS retry can project owned fields before the final SQLite gate sees the candidate.
        expect(
          result.ok && (result.corrected === true || result.merged === true),
          receiptDetails,
        ).toBe(true)
      }
      await expect
        .poll(async () =>
          page.evaluate(async nodeId => {
            const state = (await window.opencoveApi.persistence.readAppState()).state as {
              workspaces: Array<{
                nodes: Array<{
                  id: string
                  position: { x: number }
                  agent: { resumeSessionId: string }
                  managedClaudeResumeBindingOwnership?: { activationId: string }
                }>
              }>
            }
            const node = state.workspaces.flatMap(w => w.nodes).find(n => n.id === nodeId)!
            return {
              resumeSessionId: node.agent.resumeSessionId,
              x: node.position.x,
              activationId: node.managedClaudeResumeBindingOwnership?.activationId,
            }
          }, agent.id),
        )
        .toEqual({
          resumeSessionId: current.tuple.resumeSessionId,
          x: raw ? 1300 : 1200,
          activationId: current.activationId,
        })
      expect((await getBinding(page, agent.id)).tuple).toEqual(expectedTuple)
    }
    // Prove the stale save cannot roll B back, including a complete Desktop + Worker restart.
    await web.context().setOffline(true)
    const callsBefore = (await readFile(logPath, 'utf8')).trim().split('\n').length
    await app.close()
    app = undefined
    await stopWorker(worker)
    worker = null
    worker = (await startWorker({ userDataDir, env, port: workerPort, token: connection.token }))
      .child
    worker.stdout.resume()
    worker.stderr.resume()
    const restarted = await launchApp({ userDataDir, cleanupUserDataDir: false, env })
    app = restarted.electronApp
    await expect
      .poll(async () =>
        (await readFile(logPath, 'utf8'))
          .trim()
          .split('\n')
          .slice(callsBefore)
          .map(line => JSON.parse(line) as { mode: string; sessionId: string })
          .some(call => call.mode === 'resume' && call.sessionId === nextId),
      )
      .toBe(true)
    expect((await getBinding(restarted.window, agent.id)).tuple).toEqual({
      resumeSessionId: nextId,
      resumeSessionIdVerified: true,
    })
    await expectConversation(restarted.window, agent.id, nextId)
    page = restarted.window
    // Drop all invalidations while disconnected, commit C, then restart the Worker.
    const finalId = await syntheticRebind(userDataDir, home, workspace, agent.id, nextId)
    await expectConversation(page, agent.id, finalId)
    await stopWorker(worker)
    worker = null
    worker = (await startWorker({ userDataDir, env, port: workerPort, token: connection.token }))
      .child
    worker.stdout.resume()
    worker.stderr.resume()
    await web.context().setOffline(false)
    // Existing EventSource reconnects to the same configured Web listener with an empty buffer.
    await expectConversation(web, agent.id, finalId)
    await expectConversation(page, agent.id, finalId)
    await web.close()
  } finally {
    try {
      await app?.close()
    } finally {
      try {
        if (webContext) {
          const tracePath = test.info().outputPath('continuity-web-trace.zip')
          await webContext.tracing.stop({ path: tracePath })
          await test.info().attach('Web continuity trace', {
            path: tracePath,
            contentType: 'application/zip',
          })
        }
      } finally {
        try {
          await browser.close()
        } finally {
          try {
            await stopWorker(worker)
          } finally {
            await removePathWithRetry(userDataDir)
          }
        }
      }
    }
  }
})
