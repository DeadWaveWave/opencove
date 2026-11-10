import { createAgentWaitArgs } from '../support/cliNodeCreateAgentWait'
import { shellWord } from '../../src/app/cli/core/shellWord'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'

// The stub receives the actual launch prompt and reports through the invocation's hook channel.
// It never accepts PTY input, so an accidental second prompt cannot make these assertions pass.
const stub = `
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
const [provider, cwd, , , , , ...args] = process.argv.slice(2)
const prompt = args.find(value => ['Initial reply', 'Permission check', 'Question check'].includes(value))
if (!prompt) throw new Error('Expected initial prompt in the real provider launch arguments')
const prefix = provider === 'codex' ? 'OPENCOVE_CODEX_HOOK' : 'OPENCOVE_CLAUDE_HOOK'
const providerSessionId = randomUUID()
const index = args.indexOf('--session-id')
const sessionId = index >= 0 ? args[index + 1] : providerSessionId
const post = async (event, fields = {}) => {
  const response = await fetch(process.env[prefix + '_ENDPOINT'], {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-opencove-hook-token': process.env[prefix + '_TOKEN'] },
    body: JSON.stringify({ session_id: sessionId, transcript_path: join(cwd, 'initial-turn.jsonl'), cwd,
      hook_event_name: event, turn_id: 'initial-provider-turn', prompt_id: 'initial-prompt', prompt,
      emittedAtMs: Date.now(), ...fields }),
  })
  if (!response.ok) throw new Error('Hook failed: ' + response.status)
}
await post('UserPromptSubmit')
if (prompt !== 'Initial reply') {
  await post('PermissionRequest', { tool_name: prompt === 'Permission check' ? 'Bash' : 'AskUserQuestion', tool_input: {
    questions: [{ question: 'Allow access?', options: [{ label: 'Allow' }, { label: 'Deny' }] }],
  } })
} else {
  await post('Stop', { last_assistant_message: 'Initial stub reply', stop_hook_active: false })
}
setInterval(() => {}, 1000)
`

for (const scenario of [
  { provider: 'claude-code', dialog: null },
  { provider: 'codex', dialog: null },
  { provider: 'claude-code', dialog: 'permission' },
  { provider: 'claude-code', dialog: 'question' },
]) {
  test(`create agent waits for ${scenario.provider} initial ${scenario.dialog ?? 'reply'} through the CLI`, async () => {
    test.skip(
      scenario.provider === 'codex' && process.platform === 'win32',
      'Codex lifecycle hooks require POSIX',
    )
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
      const output = await terminalCommand(
        page,
        binding,
        [
          'opencove',
          ...createAgentWaitArgs(
            scenario.provider,
            scenario.dialog === 'permission'
              ? 'Permission check'
              : scenario.dialog === 'question'
                ? 'Question check'
                : 'Initial reply',
          ),
        ]
          .map(shellWord)
          .join(' '),
        'CREATE_WAIT',
      )
      const compact = output.replaceAll('\n', '')
      if (scenario.dialog) {
        expect(compact).toMatch(/\bexit=10\b/)
        const start = compact.indexOf('{'),
          end = compact.lastIndexOf('}')
        const error = JSON.parse(compact.slice(start, end + 1)).error
        expect(error).toMatchObject({
          code: 'agent.wait_attention',
          retryable: false,
          details: {
            nodeId: expect.any(String),
            sessionId: expect.any(String),
            turnId: expect.any(String),
            targets: [
              {
                blockedReason: scenario.dialog,
                blockedSummary:
                  scenario.dialog === 'permission'
                    ? null
                    : {
                        kind: 'question',
                        questions: [{ question: 'Allow access?', options: ['Allow', 'Deny'] }],
                      },
              },
            ],
          },
        })
        expect(error.hint).toContain(
          `agent wait --node ${error.details.nodeId} --turn ${error.details.turnId}`,
        )
      } else {
        const result = jsonOutput(output)
        expect(result).toMatchObject({
          node: {
            id: expect.any(String),
            sessionId: expect.any(String),
            spawnedBy: binding.nodeId,
          },
          outcome: 'completed',
          turnId: expect.any(String),
          reply: { message: 'Initial stub reply', source: 'hook' },
        })
        const node = result.node as { id: string; sessionId: string }
        expect(result.reply).toMatchObject({
          nodeId: node.id,
          sessionId: node.sessionId,
          turnId: result.turnId,
        })
      }
      const agents = await page.evaluate(async () =>
        window.opencoveApi.controlSurface.invoke<{ nodes: unknown[] }>({
          kind: 'query',
          id: 'node.list',
          payload: { projectId: 'create-wait-project', kind: 'agent' },
        }),
      )
      expect(agents.nodes).toHaveLength(1)
    } finally {
      try {
        await app?.close()
      } finally {
        await removePathWithRetry(root)
      }
    }
  })
}
