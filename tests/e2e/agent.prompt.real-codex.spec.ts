import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { expect, test } from '@playwright/test'
import type { AgentRunSnapshot } from '../../src/shared/contracts/dto/agentRunState'
import { launchApp, seedWorkspaceState } from './workspace-canvas.helpers'
import { resolveFirstAgentSessionId } from './workspace-canvas.agent-status-watcher.helpers'

// Opt-in local acceptance with the installed Codex CLI, an isolated CODEX_HOME and a local
// Responses API stand-in (no credentials, no model calls). Run with
// OPENCOVE_TEST_USE_REAL_AGENTS=1 pnpm exec playwright test tests/e2e/agent.prompt.real-codex.spec.ts

type ResponsesInputItem = {
  type?: string
  role?: string
  content?: Array<{ type: string; text?: string }>
}
type ResponsesRequest = {
  stream?: boolean
  tools?: Array<{ name?: string }>
  input?: ResponsesInputItem[]
}

function lastUserBlocks(body: ResponsesRequest): string[] {
  const last = (body.input ?? [])
    .filter(item => item.type === 'message' && item.role === 'user')
    .at(-1)
  return (last?.content ?? [])
    .filter(block => block.type === 'input_text')
    .map(block => block.text ?? '')
}

function continuesToolCall(body: ResponsesRequest): boolean {
  return (body.input ?? []).at(-1)?.type === 'function_call_output'
}

function respond(res: ServerResponse, approvalProbe: boolean, slowTool = false): void {
  const id = `resp_${Date.now()}`
  const item = slowTool
    ? {
        type: 'function_call',
        id: 'fc_sleep',
        call_id: `call_sleep_${Date.now()}`,
        name: 'exec_command',
        status: 'completed',
        arguments: JSON.stringify({ cmd: 'sleep 3' }),
      }
    : approvalProbe
      ? {
          type: 'function_call',
          id: 'fc_probe',
          call_id: 'call_probe',
          name: 'exec_command',
          status: 'completed',
          // Escalation outside the sandbox needs the user's approval under on-request.
          arguments: JSON.stringify({
            cmd: 'touch opencove-approval-probe.txt',
            sandbox_permissions: 'require_escalated',
            justification: 'Create the approval probe file',
          }),
        }
      : {
          type: 'message',
          id: 'msg_ack',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'ACK', annotations: [] }],
        }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (type: string, data: Record<string, unknown>) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  send('response.created', { response: { id, status: 'in_progress', output: [] } })
  send('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } })
  send('response.output_item.done', { output_index: 0, item })
  send('response.completed', {
    response: {
      id,
      status: 'completed',
      output: [item],
      usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
    },
  })
  res.end()
}

async function startResponsesApi(): Promise<{
  server: Server
  url: string
  main: () => string[][]
  all: () => string[]
}> {
  // Text blocks of the latest user message in each agent-loop request that starts a turn.
  const mainTurns: string[][] = []
  // User text of every agent-loop request, including requests that resume after a tool call.
  const allUserText: string[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    let body: ResponsesRequest | null = null
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ResponsesRequest
    } catch {
      body = null
    }
    if (req.method === 'POST' && (req.url ?? '').includes('/responses') && body) {
      const isMain = (body.tools ?? []).some(tool => tool.name === 'exec_command')
      const blocks = lastUserBlocks(body)
      const resumed = continuesToolCall(body)
      if (isMain && !resumed) {
        mainTurns.push(blocks)
      }
      if (isMain) {
        allUserText.push(
          (body.input ?? [])
            .filter(item => item.type === 'message' && item.role === 'user')
            .flatMap(item => (item.content ?? []).map(block => block.text ?? ''))
            .join('\n'),
        )
      }
      respond(
        res,
        isMain && !resumed && blocks.some(block => block.includes('TRIGGER_TOOL')),
        isMain && !resumed && blocks.some(block => block.includes('SLOW_TOOL')),
      )
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    server,
    url: `http://127.0.0.1:${port}/v1`,
    main: () => [...mainTurns],
    all: () => [...allUserText],
  }
}

// Drive delivery through the CLI with the desktop credential, as a script outside the app would.
async function prompt(userDataDir: string, nodeId: string, text: string) {
  return await new Promise<{ exitCode: number; stdout: string; stderr: string }>(done => {
    const child = execFile(
      process.execPath,
      [
        resolvePath('out/cli/opencove.mjs'),
        'agent',
        'prompt',
        '--node',
        nodeId,
        '--text-file',
        '-',
      ],
      { env: { ...process.env, OPENCOVE_USER_DATA_DIR: userDataDir }, timeout: 60_000 },
      (error, stdout, stderr) =>
        done({
          exitCode: error ? Number((error as { code?: unknown }).code ?? 1) : 0,
          stdout,
          stderr,
        }),
    )
    child.stdin?.end(text)
  })
}

async function cli(userDataDir: string, args: string[]) {
  return await new Promise<{ exitCode: number; stdout: string; stderr: string }>(done => {
    execFile(
      process.execPath,
      [resolvePath('out/cli/opencove.mjs'), ...args],
      { env: { ...process.env, OPENCOVE_USER_DATA_DIR: userDataDir }, timeout: 60_000 },
      (error, stdout, stderr) =>
        done({
          exitCode: error ? Number((error as { code?: unknown }).code ?? 1) : 0,
          stdout,
          stderr,
        }),
    )
  })
}

test.describe('agent.prompt with the real Codex CLI', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Codex CLI')
  test.skip(process.platform === 'win32', 'Codex lifecycle hooks are not used on Windows')

  test('submits one multi-line message and refuses an open approval request', async ({
    browserName: _browserName,
  }, testInfo) => {
    test.setTimeout(180_000)
    const version = execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 10_000 })
    await testInfo.attach('real-cli-version', {
      body: Buffer.from(version),
      contentType: 'text/plain',
    })
    const root = await realpath(await mkdtemp(join(tmpdir(), 'opencove-real-codex-')))
    const workspace = join(root, 'workspace')
    const codexHome = join(root, 'codex-home')
    const userDataDir = join(root, 'user-data')
    await mkdir(workspace, { recursive: true })
    await mkdir(codexHome, { recursive: true })
    const api = await startResponsesApi()
    await writeFile(
      join(codexHome, 'config.toml'),
      [
        'model = "test-model"',
        'model_provider = "mock"',
        'check_for_update_on_startup = false',
        '',
        '[model_providers.mock]',
        'name = "mock"',
        `base_url = "${api.url}"`,
        'wire_api = "responses"',
        'env_key = "OPENCOVE_TEST_MOCK_API_KEY"',
        '',
        `[projects."${workspace}"]`,
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    )
    const { electronApp, window } = await launchApp({
      userDataDir,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_USE_REAL_AGENTS: '1',
        OPENCOVE_TEST_CODEX_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_TEST_MOCK_API_KEY: 'opencove-local-diagnostic-not-a-real-key',
        CODEX_HOME: codexHome,
      },
    })
    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'real-codex',
        settings: {
          defaultProvider: 'codex',
          agentFullAccess: false,
          customModelEnabledByProvider: { codex: false },
        },
        workspaces: [
          {
            id: 'real-codex',
            name: 'Real Codex',
            path: workspace,
            nodes: [
              {
                id: 'real-codex-task',
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
      await window.locator('[data-testid="task-node-run-agent"]').click()
      await expect
        .poll(() => resolveFirstAgentSessionId(window), { timeout: 30_000 })
        .not.toBeNull()
      const sessionId = (await resolveFirstAgentSessionId(window))!
      const snapshot = () =>
        window.evaluate(
          id =>
            window.opencoveApi.controlSurface.invoke<AgentRunSnapshot>({
              kind: 'query',
              id: 'agent.get',
              payload: { sessionId: id },
            }),
          sessionId,
        )
      // The launch prompt completes one real turn; its Stop hook establishes readiness.
      await expect
        .poll(
          async () => {
            const value = await snapshot()
            return `${value.state}:${value.source}`
          },
          { timeout: 60_000 },
        )
        .toBe('idle:codex_hook')
      expect(
        api.main().some(blocks => blocks.some(block => block.includes('Reply with ACK.'))),
      ).toBe(true)
      const turnsBeforePrompt = api.main().length
      const nodeId = (await snapshot()).nodeId!

      const text = 'Line one of the prompt\nLine two of the prompt\nLine three of the prompt'
      const delivered = await prompt(userDataDir, nodeId, text)
      expect(delivered.exitCode, JSON.stringify(delivered)).toBe(0)
      expect(JSON.parse(delivered.stdout)).toMatchObject({ phase: 'submission_observed' })
      await expect.poll(() => api.main().length, { timeout: 30_000 }).toBe(turnsBeforePrompt + 1)
      // One submission whose user message carries the three lines as one exact text block.
      expect(api.main().at(-1)).toContain(text)
      await expect.poll(async () => (await snapshot()).state, { timeout: 30_000 }).toBe('idle')

      // Codex sends its legacy notify for the previous turn about a second after that turn ends.
      // It must not show the next, still-running turn as idle.
      const slow = await prompt(userDataDir, nodeId, 'SLOW_TOOL wait a moment')
      expect(slow.exitCode, JSON.stringify(slow)).toBe(0)
      const slowTurn = JSON.parse(slow.stdout).turnId
      const seen: string[] = []
      await expect
        .poll(
          async () => {
            const value = await snapshot()
            seen.push(`${value.state}:${value.turn?.id ?? ''}`)
            return value.lastEndedTurn?.id
          },
          { timeout: 30_000, intervals: [100] },
        )
        .toBe(slowTurn)
      const duringSlowTurn = seen.filter(entry => entry.endsWith(`:${slowTurn}`))
      expect(duringSlowTurn.length).toBeGreaterThan(10)
      expect(duringSlowTurn.filter(entry => !entry.startsWith('working:'))).toEqual([])

      // A prompt sent while Codex works is typed in as steering. Codex shows it queued and submits
      // it after the running tool call, inside the same turn; the CLI reports it dispatched and the
      // delivery record confirms it once Codex submits it.
      const busy = await prompt(userDataDir, nodeId, 'SLOW_TOOL wait again')
      expect(busy.exitCode, JSON.stringify(busy)).toBe(0)
      const busyTurn = JSON.parse(busy.stdout).turnId
      await expect.poll(async () => (await snapshot()).turn?.id, { timeout: 15_000 }).toBe(busyTurn)
      await window.waitForTimeout(800)
      const steer = await prompt(userDataDir, nodeId, 'Steer: also mention CHERRY')
      expect(steer.exitCode, JSON.stringify(steer)).toBe(0)
      const steered = JSON.parse(steer.stdout)
      expect(steered).toMatchObject({ mode: 'steer', phase: 'dispatched', turnId: busyTurn })
      const confirmed = await cli(userDataDir, [
        'agent',
        'delivery',
        steered.deliveryId,
        '--wait',
        '--timeout',
        '30s',
      ])
      expect(confirmed.exitCode, JSON.stringify(confirmed)).toBe(0)
      expect(JSON.parse(confirmed.stdout)).toMatchObject({ status: 'submitted', turnId: busyTurn })
      expect(api.all().some(userText => userText.includes('Steer: also mention CHERRY'))).toBe(true)
      await expect
        .poll(async () => (await snapshot()).lastEndedTurn?.id, { timeout: 30_000 })
        .toBe(busyTurn)

      const tool = await prompt(userDataDir, nodeId, 'TRIGGER_TOOL run the probe')
      expect(tool.exitCode, JSON.stringify(tool)).toBe(0)
      await expect
        .poll(
          async () => {
            const value = await snapshot()
            return `${value.state}:${value.blockedReason}`
          },
          { timeout: 30_000 },
        )
        .toBe('waiting:permission')
      const turnsBefore = api.main().length
      const refused = await prompt(userDataDir, nodeId, 'MUST_NOT_ARRIVE')
      expect(refused.exitCode, JSON.stringify(refused)).toBe(1)
      expect(refused.stdout).toBe('')
      expect(refused.stderr).toContain('agent.blocked')
      await window.waitForTimeout(2_000)
      expect(api.main()).toHaveLength(turnsBefore)
      const screen = await window
        .locator('.terminal-node')
        .filter({ has: window.locator('.terminal-node__status') })
        .first()
        .innerText()
      expect(screen).not.toContain('MUST_NOT_ARRIVE')
      await testInfo.attach('approval-dialog', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
      api.server.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
