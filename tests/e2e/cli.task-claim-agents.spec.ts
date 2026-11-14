import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { getNode, persistedNodes, projectId, taskId, noteId } from './cli.task-notes.helpers'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'

// Actual model/tool use: opt in with an API key; all provider config stays in the temporary profile.
test('two real OpenCove agents compete for a task and only the winner works and releases', async () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires opt-in real Claude agents')
  test.skip(
    !process.env.ANTHROPIC_API_KEY,
    'Requires ANTHROPIC_API_KEY for isolated Claude configuration',
  )
  test.setTimeout(300_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-task-claim-agents-'))
  let app: ElectronApplication | undefined
  try {
    const workspace = join(root, 'project'),
      config = join(root, 'claude')
    await mkdir(workspace)
    await mkdir(config)
    const key = process.env.ANTHROPIC_API_KEY!
    await writeFile(
      join(config, '.claude.json'),
      JSON.stringify({
        hasCompletedOnboarding: true,
        customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] },
        projects: { [workspace]: { hasTrustDialogAccepted: true } },
      }),
    )
    const version = await promisify(execFile)('claude', ['--version'], {
      timeout: 10_000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
    })
    await test
      .info()
      .attach('provider-version', { body: version.stdout, contentType: 'text/plain' })
    const driver = join(root, 'claim-workflow.mjs')
    // The provider must execute this script itself, with its own inherited session grant.
    // Only claim's success branch may append or release. Every CLI call is recorded without credentials.
    await writeFile(
      driver,
      `
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
const root = ${JSON.stringify(root)}, cli = ${JSON.stringify(resolve('out/cli/opencove.mjs'))}
const id = process.env.OPENCOVE_NODE_ID
if (!id || !process.env.OPENCOVE_ENV) throw new Error('Run inside the managed agent session')
const calls = []
async function run(args) {
  const result = await new Promise(resolve => execFile(process.execPath, [cli, ...args], { env: process.env, timeout: 30000 }, (error, stdout, stderr) => resolve({ args, code: error?.code ?? 0, stdout, stderr })))
  calls.push(result); return result
}
await writeFile(root + '/' + id + '.barrier', 'ready')
const deadline = Date.now() + 180000
while (true) {
  try { await readFile(root + '/claim.gate'); break } catch { if (Date.now() > deadline) throw new Error('Claim barrier timed out'); await setTimeout(50) }
}
const identity = await run(['whoami'])
const claim = await run(['task', 'claim', '--task', ${JSON.stringify(taskId)}, '-o', 'json'])
await writeFile(root + '/' + id + '.claim.json', JSON.stringify(claim))
if (claim.code === 0) {
  while (true) {
    try { await readFile(root + '/work.gate'); break } catch { if (Date.now() > deadline) throw new Error('Work barrier timed out'); await setTimeout(50) }
  }
  await run(['note', 'append', '--node', ${JSON.stringify(noteId)}, '--text', 'completed-by-' + id, '-o', 'json'])
  await run(['task', 'release', '--task', ${JSON.stringify(taskId)}, '--status', 'ai_done', '-o', 'json'])
}
await writeFile(root + '/' + id + '.result.json', JSON.stringify({ provider: 'claude-code', calls }))
`,
    )
    const launched = await launchApp({
      userDataDir: join(root, 'profile'),
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '1',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
        CLAUDE_CONFIG_DIR: config,
        CODEX_HOME: join(root, 'codex'),
        ANTHROPIC_API_KEY: key,
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      settings: { agentFullAccess: true, defaultProvider: 'claude-code' },
      workspaces: [
        {
          id: projectId,
          name: 'Claim competition',
          path: workspace,
          activeSpaceId: null,
          spaces: [],
          nodes: [
            {
              id: taskId,
              kind: 'task',
              title: 'Claim competition',
              position: { x: 50, y: 50 },
              width: 460,
              height: 280,
              task: {
                requirement: 'Only the winning agent records work',
                status: 'todo',
                linkedAgentNodeId: null,
                agentSessions: [],
                lastRunAt: null,
                autoGeneratedTitle: false,
              },
            },
            {
              id: noteId,
              kind: 'note',
              title: 'Winner result',
              position: { x: 600, y: 50 },
              width: 360,
              height: 260,
              task: { text: '' },
            },
          ],
        },
      ],
    })
    const prompt = `Execute exactly this command once with your shell tool: ${JSON.stringify(process.execPath)} ${JSON.stringify(driver)}. It synchronizes your first task claim with another agent. Wait for it to finish. It records the result and performs authorized work only if your claim succeeds. Do not run any other OpenCove command, and do not retry the script.`
    const agents: CreateNodeResult['node'][] = []
    /* eslint-disable no-await-in-loop -- Start each provider once; synchronize their first claim with the file barrier. */
    for (const title of ['Claimant A', 'Claimant B']) {
      // eslint-disable-next-line no-await-in-loop
      agents.push(
        (
          await page.evaluate(
            async payload =>
              window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
                kind: 'command',
                id: 'node.create',
                payload: {
                  kind: 'agent',
                  projectId: payload.projectId,
                  title: payload.title,
                  data: { provider: 'claude-code', prompt: payload.prompt, agentFullAccess: true },
                },
              }),
            { projectId, title, prompt },
          )
        ).node,
      )
    }
    await expect
      .poll(
        async () =>
          Promise.all(
            agents.map(a => readFile(join(root, a.id + '.barrier'), 'utf8').catch(() => '')),
          ),
        { timeout: 180_000 },
      )
      .toEqual(['ready', 'ready'])
    await writeFile(join(root, 'claim.gate'), 'go')
    await expect
      .poll(
        async () =>
          Promise.all(
            agents.map(a =>
              readFile(join(root, a.id + '.claim.json'), 'utf8')
                .then(s => JSON.parse(s).code)
                .catch(() => -1),
            ),
          ),
        { timeout: 60_000 },
      )
      .toEqual(expect.arrayContaining([0, 1]))
    await writeFile(join(root, 'work.gate'), 'go')
    type Call = { args: string[]; code: number; stdout: string; stderr: string }
    const results: { calls: Call[] }[] = []
    await expect
      .poll(
        async () => {
          results.length = 0
          for (const agent of agents) {
            try {
              // eslint-disable-next-line no-await-in-loop
              results.push(
                JSON.parse(await readFile(join(root, agent.id + '.result.json'), 'utf8')),
              )
            } catch {
              return false
            }
          }
          return results.length === 2
        },
        { timeout: 90_000 },
      )
      .toBe(true)
    /* eslint-enable no-await-in-loop */
    const claims = results.map(
      r => r.calls.find(c => c.args[0] === 'task' && c.args[1] === 'claim')!,
    )
    expect(claims.map(c => c.code).sort()).toEqual([0, 1])
    const winnerIndex = claims.findIndex(c => c.code === 0),
      loserIndex = 1 - winnerIndex
    expect(JSON.parse(claims[loserIndex].stderr).error).toMatchObject({
      code: 'task.already_claimed',
      details: { holder: { nodeId: agents[winnerIndex].id } },
    })
    expect(results[loserIndex].calls.map(c => c.args[0])).toEqual(['whoami', 'task'])
    expect(results[winnerIndex].calls.map(c => c.code)).toEqual([0, 0, 0, 0])
    const identities = results.map(r => JSON.parse(r.calls[0].stdout))
    expect(identities.map(i => i.nodeId)).toEqual(agents.map(a => a.id))
    expect(identities[0].sessionId).not.toBe(identities[1].sessionId)
    expect((await getNode(page, noteId)).node.data).toMatchObject({
      text: 'completed-by-' + agents[winnerIndex].id,
    })
    expect((await getNode(page, taskId)).node.data).toMatchObject({
      status: 'ai_done',
      linkedAgentNodeId: null,
    })
    await test.info().attach('agent-claim-evidence', {
      body: JSON.stringify(
        { provider: version.stdout.trim(), results, finalState: await persistedNodes(page) },
        null,
        2,
      ),
      contentType: 'application/json',
    })
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
