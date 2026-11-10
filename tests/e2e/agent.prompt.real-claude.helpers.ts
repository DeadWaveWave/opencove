import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { expect, type TestInfo } from '@playwright/test'
import type { AgentRunSnapshot } from '../../src/shared/contracts/dto/agentRunState'
import { launchApp, seedWorkspaceState } from './workspace-canvas.helpers'
import { resolveFirstAgentSessionId } from './workspace-canvas.agent-status-watcher.helpers'

// Shared harness for the opt-in real Claude Code acceptance specs: the installed Claude Code CLI,
// an isolated config and a local Messages API stand-in (no credentials, no model calls).

export type MessagesRequest = {
  system?: string | Array<{ type: string; text?: string }>
  stream?: boolean
  model?: string
  tools?: Array<{ name?: string }>
  messages?: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
}

// Claude Code may append system-role messages after the user turn; read the last user message.
export function lastUser(body: MessagesRequest | null) {
  return body?.messages?.filter(message => message.role === 'user').at(-1)
}

export function lastUserBlocks(body: MessagesRequest | null): string[] {
  const last = lastUser(body)
  if (!last) {
    return []
  }
  return typeof last.content === 'string'
    ? [last.content]
    : last.content.filter(block => block.type === 'text').map(block => block.text ?? '')
}

export function hasToolResult(body: MessagesRequest | null): boolean {
  const last = lastUser(body)
  return Array.isArray(last?.content) && last.content.some(block => block.type === 'tool_result')
}

export function sse(res: ServerResponse, events: Array<Record<string, unknown>>): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const event of events) {
    res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  res.end()
}

export function reply(
  res: ServerResponse,
  body: MessagesRequest,
  toolUse: boolean,
  text = 'ACK',
): void {
  const model = body.model ?? 'claude-test'
  const usage = { input_tokens: 12, output_tokens: 4 }
  const message = { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model }
  // AskUserQuestion opens a blocking dialog in every permission mode (auto mode runs Bash).
  const block = toolUse
    ? {
        type: 'tool_use',
        id: `toolu_${Date.now()}`,
        name: 'AskUserQuestion',
        input: {},
      }
    : { type: 'text', text: '' }
  const delta = toolUse
    ? {
        type: 'input_json_delta',
        partial_json: JSON.stringify({
          questions: [
            {
              question: 'Which option should the probe use?',
              header: 'Probe',
              multiSelect: false,
              options: [
                { label: 'First', description: 'Use the first option' },
                { label: 'Second', description: 'Use the second option' },
              ],
            },
          ],
        }),
      }
    : { type: 'text_delta', text }
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ...message,
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage,
      }),
    )
    return
  }
  sse(res, [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage } },
    { type: 'content_block_start', index: 0, content_block: block },
    { type: 'content_block_delta', index: 0, delta },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: toolUse ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 4 },
    },
    { type: 'message_stop' },
  ])
}

export async function startMessagesApi(): Promise<{
  server: Server
  url: string
  main: () => string[][]
  requests: () => MessagesRequest[]
}> {
  // Text blocks of the user message in each agent-loop request that starts a turn.
  const mainTurns: string[][] = []
  const requests: MessagesRequest[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    let body: MessagesRequest | null = null
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as MessagesRequest
    } catch {
      body = null
    }
    const url = req.url ?? ''
    if (req.method === 'POST' && url.startsWith('/v1/messages/count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ input_tokens: 12 }))
      return
    }
    if (req.method === 'POST' && url.startsWith('/v1/messages') && body) {
      // The agent loop sends tools; side requests (titles, summaries) do not.
      const isMain = (body.tools ?? []).some(tool => tool.name === 'Bash')
      if (isMain) {
        requests.push(structuredClone(body))
      }
      const blocks = lastUserBlocks(body)
      if (isMain && !hasToolResult(body)) {
        mainTurns.push(blocks)
      }
      const trigger = blocks.some(block => block.includes('TRIGGER_TOOL'))
      // A very long final reply makes the Stop hook body exceed the relay's post limit.
      const long = isMain && blocks.some(block => block.includes('LONG_REPLY'))
      // A slow text-only reply leaves no tool boundary, so a message typed meanwhile is queued
      // and Claude answers it in a follow-up provider turn after this one.
      if (isMain && !hasToolResult(body) && blocks.some(block => block.includes('SLOW_TEXT'))) {
        setTimeout(() => reply(res, body!, false, 'DONE-TEXT'), 6_000)
        return
      }
      reply(
        res,
        body,
        isMain && trigger && !hasToolResult(body),
        long ? 'L'.repeat(300_000) : 'ACK',
      )
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    main: () => [...mainTurns],
    requests: () => structuredClone(requests),
  }
}

export async function cli(userDataDir: string, args: string[]) {
  return await new Promise<{ exitCode: number; stdout: string; stderr: string }>(done => {
    execFile(
      process.execPath,
      [resolvePath('out/cli/opencove.mjs'), ...args],
      {
        env: { ...process.env, OPENCOVE_USER_DATA_DIR: userDataDir },
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) =>
        done({
          exitCode: error ? Number((error as { code?: unknown }).code ?? 1) : 0,
          stdout,
          stderr,
        }),
    )
  })
}

// Drive delivery through the CLI with the desktop credential, as a script outside the app would.
export async function prompt(userDataDir: string, nodeId: string, text: string) {
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

export async function launchRealClaude(
  testInfo: TestInfo,
  residentContext: 'suggest' | 'off' = 'suggest',
) {
  const version = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 10_000 })
  await testInfo.attach('real-cli-version', {
    body: Buffer.from(version),
    contentType: 'text/plain',
  })
  const root = await realpath(await mkdtemp(join(tmpdir(), 'opencove-real-prompt-')))
  const workspace = join(root, 'workspace')
  const config = join(root, 'claude-config')
  const userDataDir = join(root, 'user-data')
  await mkdir(workspace, { recursive: true })
  await mkdir(config, { recursive: true })
  const apiKey = 'opencove-local-diagnostic-not-a-real-key'
  await writeFile(
    join(config, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      // One-time permission-mode notices are modal and invisible to hooks; mark them seen.
      hasSeenAutoDefaultNotice: true,
      hasSeenAutoModeEntryWarning: true,
      hasSeenAutoModeOutsideReadPrompt: true,
      customApiKeyResponses: { approved: [apiKey.slice(-20)], rejected: [] },
      projects: { [workspace]: { hasTrustDialogAccepted: true } },
    }),
  )
  const api = await startMessagesApi()
  const { electronApp, window } = await launchApp({
    userDataDir,
    cleanupUserDataDir: false,
    env: {
      OPENCOVE_TEST_USE_REAL_AGENTS: '1',
      OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: api.url,
      CLAUDE_CONFIG_DIR: config,
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  })
  await seedWorkspaceState(window, {
    activeWorkspaceId: 'real-prompt',
    settings: {
      defaultProvider: 'claude-code',
      agentResidentContext: residentContext,
      agentFullAccess: false,
      customModelEnabledByProvider: { 'claude-code': false },
    },
    workspaces: [
      {
        id: 'real-prompt',
        name: 'Real prompt',
        path: workspace,
        activeSpaceId: 'real-prompt-main',
        spaces: [
          {
            id: 'real-prompt-main',
            name: 'Main',
            directoryPath: workspace,
            nodeIds: ['real-prompt-task'],
            rect: { x: 20, y: 20, width: 1600, height: 900 },
          },
        ],
        nodes: [
          {
            id: 'real-prompt-task',
            title: 'Prompt task',
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
  await expect.poll(() => resolveFirstAgentSessionId(window), { timeout: 30_000 }).not.toBeNull()
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
    .toBe('idle:claude_hook')
  expect(api.main()).toHaveLength(1)
  expect(api.main()[0]).toContain('Reply with ACK.')
  const nodeId = (await snapshot()).nodeId!
  return {
    electronApp,
    window,
    api,
    root,
    userDataDir,
    sessionId,
    nodeId,
    snapshot,
    async close() {
      await electronApp.close()
      api.server.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
