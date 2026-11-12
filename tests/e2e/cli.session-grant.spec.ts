/* eslint-disable no-await-in-loop -- Each request observes the preceding mutation or authorization boundary. */
import { expect, test, type ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import type { AgentRunSnapshot } from '../../src/shared/contracts/dto/agentRunState'
import { encodeClaudeProjectPath } from '../../src/contexts/agent/infrastructure/ClaudeProjectPaths'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { createCommandPlugin } from './plugins.commands.helpers'
import { canvasRuntimeFootprint, jsonOutput, terminalCommand } from './cli.terminal.helpers'
import { assertGrantLaunchPolicy, assertFullAccessChoice } from './cli.session-grant.helpers'

const projectId = 'grant-project',
  spaceId = 'grant-main',
  worktreeSpace = 'grant-worktree'
const quote = (value: string) =>
  `'${value.replaceAll("'", process.platform === 'win32' ? "''" : `'"'"'`)}'`
const cli = (...args: string[]) => ['opencove', ...args.map(quote)].join(' ')

test('session grants preserve agent workflows and refuse human decisions', async () => {
  test.setTimeout(180_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-grants-'))
  const workspace = join(root, 'project'),
    profile = join(root, 'profile')
  const record = join(root, 'prompt-record.jsonl'),
    dialog = join(root, 'dialog')
  let pluginDirectory: string | undefined
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const git = promisify(execFile)
    await git('git', ['init', '-b', 'main', workspace])
    await writeFile(join(workspace, 'README.md'), 'Grant fixture\n')
    await git('git', ['-C', workspace, 'add', 'README.md'])
    await git('git', [
      '-C',
      workspace,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'Initial fixture',
    ])
    const launched = await launchApp({
      userDataDir: profile,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-prompt-strict',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
        OPENCOVE_TEST_PROMPT_RECORD: record,
        OPENCOVE_TEST_PROMPT_DIALOG: dialog,
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      settings: { defaultProvider: 'claude-code', agentFullAccess: false },
      workspaces: [
        {
          id: projectId,
          name: 'Grant project',
          path: workspace,
          activeSpaceId: spaceId,
          nodes: [],
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 1600, height: 1000 },
            },
            {
              id: worktreeSpace,
              name: 'Worktree',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 1800, y: 0, width: 800, height: 600 },
            },
          ],
        },
      ],
    })
    const created = await page.evaluate(
      async ({ spaceId: targetSpaceId, shell }) =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: targetSpaceId },
            title: 'Grant CLI',
            data: { shell },
          },
        }),
      { spaceId, shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' },
    )
    const binding = { nodeId: created.node.id, sessionId: created.node.sessionId! }
    expect(binding.sessionId).toBeTruthy()
    const command = (...args: string[]) =>
      terminalCommand(page, binding, cli(...args), args.slice(0, 2).join('_'))
    const success = async (...args: string[]) => {
      const output = await command(...args)
      expect(output, args.join(' ')).toMatch(/\bexit=0\b/)
      return output
    }
    const object = async (...args: string[]) => jsonOutput(await success(...args))
    const invalidPty = await command(
      'pty',
      'attach',
      '--session',
      binding.sessionId,
      '--token',
      'invalid-test-token',
    )
    expect(invalidPty).toMatch(/\bexit=4\b/)
    expect(invalidPty.replaceAll('\n', '')).toContain(
      'The control token is invalid or has been revoked.',
    )
    expect(await object('whoami')).toMatchObject({
      caller: 'session-grant',
      scope: 'interact',
      nodeId: binding.nodeId,
    })
    await object('context')
    await object('node', 'list')
    await object('node', 'get', '--node', '@self')
    await object('space', 'list')
    await object('space', 'get')
    await object('project', 'list')
    await object('mount', 'list')
    await success('skill')
    await success('api', 'schema', 'node.create')
    expect(await object('api', 'schema', 'session.writeNode')).toMatchObject({
      access: 'denied',
      reason: expect.stringContaining('only the user can answer permission prompts and dialogs'),
      policyVersion: expect.any(String),
    })
    await assertGrantLaunchPolicy({ page, projectId, spaceId, root, command, object })
    // Compact content for ConPTY wrapping only after preserving/checking the exit status line.
    const catalog = (await success('api', 'ops', '--prefix', 'session', '--limit', '0')).replaceAll(
      '\n',
      '',
    )
    expect(catalog).toContain('"access":"denied"')
    expect(catalog).toContain('"access":"constrained"')
    await object('api', 'call', 'system.whoami', '--input', '{}')
    for (const [kind, flags] of [
      ['note', ['--text', 'Brief']],
      ['task', ['--requirement', 'Verify grants']],
      ['website', ['--url', 'https://example.com']],
    ] as const) {
      const result = await object('node', 'create', kind, ...flags)
      const nodeId = (result.node as { id: string }).id
      await success('node', 'update', kind, '--node', nodeId, ...flags)
      await success('canvas', 'focus', 'node', '--node', nodeId)
      await success('node', 'delete', '--node', nodeId)
    }
    const file = pathToFileURL(join(workspace, 'grant.txt')).href
    await success('fs', 'write', '--uri', file, '--content', 'Grant IO')
    expect(await success('fs', 'read', '--uri', file)).toContain('Grant IO')
    await success('fs', 'stat', '--uri', file)
    await success('fs', 'ls', '--uri', pathToFileURL(workspace).href)
    await success('worktree', 'list')
    await success('worktree', 'create', '--space', worktreeSpace, '--name', 'grant-check')
    await success('worktree', 'archive', '--space', worktreeSpace, '--force', '--delete-branch')

    // Both nested spawn paths and deletion run under the real terminal grant.
    const child = await object(
      'node',
      'create',
      'terminal',
      '--command',
      "node -e \"setInterval(()=>console.log('VIEWER_'+'STREAM_READY'),100)\"",
    )
    const childNode = child.node as { id: string; sessionId: string }
    const attaching = command('pty', 'attach', '--session', childNode.sessionId)
    await expect
      .poll(async () =>
        page.evaluate(
          async id => (await window.opencoveApi.pty.snapshot({ sessionId: id })).data,
          binding.sessionId,
        ),
      )
      .toContain('VIEWER_STREAM_READY')
    await page.evaluate(
      async id =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'session.kill',
          payload: { sessionId: id },
        }),
      childNode.sessionId,
    )
    const attached = await attaching
    expect(attached).toContain('VIEWER_STREAM_READY')
    expect(attached).toMatch(/\bexit=[01]\b/)
    expect(attached).not.toContain('common.forbidden')
    await success('node', 'delete', '--node', childNode.id)

    const agent = await object(
      'node',
      'create',
      'agent',
      '--provider',
      'claude-code',
      '--prompt',
      '',
      '--full-access',
      'true',
    )
    const agentNode = agent.node as { id: string; sessionId: string }
    await assertFullAccessChoice(page, agentNode.id)
    const agentSnapshot = () =>
      page.evaluate(
        async id =>
          window.opencoveApi.controlSurface.invoke<AgentRunSnapshot>({
            kind: 'query',
            id: 'agent.get',
            payload: { sessionId: id },
          }),
        agentNode.sessionId,
      )
    await expect
      .poll(async () =>
        page.evaluate(
          async id => (await window.opencoveApi.pty.snapshot({ sessionId: id })).data,
          agentNode.sessionId,
        ),
      )
      .toContain('STRICT_READY')
    // A trusted UI turn establishes readiness; startup idle alone is insufficient.
    await page.evaluate(
      async targetBinding =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'session.writeNode',
          payload: { ...targetBinding, data: 'manual baseline\r' },
        }),
      { nodeId: agentNode.id, sessionId: agentNode.sessionId },
    )
    await expect
      .poll(async () =>
        page.evaluate(
          async id => (await window.opencoveApi.pty.snapshot({ sessionId: id })).data,
          agentNode.sessionId,
        ),
      )
      .toContain('STRICT_TURN_1')
    await expect.poll(async () => (await agentSnapshot()).state).toBe('idle')
    await success('agent', 'list')
    await success('agent', 'get', '--node', agentNode.id)
    await success('agent', 'read', '--node', agentNode.id, '--screen')
    const beforeCommands = await readFile(record, 'utf8')
    for (const text of ['! printenv X', '/permissions', '  /approvals', '# note']) {
      const denied = await command(
        'agent',
        'prompt',
        '--node',
        agentNode.id,
        '--text',
        text,
        '-o',
        'json',
      )
      expect(denied).toMatch(/\bexit=4\b/)
      expect(denied.replaceAll('\n', '')).toContain('field_denied')
      expect(denied.replaceAll('\n', '')).toContain('start with words')
    }
    expect(await readFile(record, 'utf8')).toBe(beforeCommands)
    const delivery = await object(
      'agent',
      'prompt',
      '--node',
      agentNode.id,
      '--text',
      'Review this project',
    )
    expect(delivery.phase).toBe('submission_observed')
    await success('agent', 'delivery', String(delivery.deliveryId), '--wait')
    await success('agent', 'wait', '--node', agentNode.id, '--turn', String(delivery.turnId))
    expect(
      (
        await success(
          'agent',
          'read',
          '--node',
          agentNode.id,
          '--turn',
          String(delivery.turnId),
          '-o',
          'json',
        )
      ).replaceAll('\n', ''),
    ).toContain('Strict reply 2')
    await success('agent', 'history', 'clear', '--node', agentNode.id)
    await writeFile(dialog, 'permission')
    // The hook publishes waiting before the stub appends its dialog-entry record.
    // Include that record in the baseline so only unexpected input changes it.
    await expect.poll(() => readFile(record, 'utf8')).toContain('{"kind":"dialog","bytes":0}\n')
    await expect.poll(async () => (await agentSnapshot()).state).toBe('waiting')
    const before = await readFile(record, 'utf8')
    expect(
      (await command('agent', 'prompt', '--node', agentNode.id, '--text', 'Approve it')).replaceAll(
        '\n',
        '',
      ),
    ).toContain('agent.blocked')
    for (const [id, input] of [
      [
        'session.writeNode',
        { nodeId: agentNode.id, sessionId: agentNode.sessionId, data: 'yes\r' },
      ],
      ['sync.writeState', { state: {} }],
      ['sync.state', {}],
      ['session.launchAgent', { spaceId, prompt: 'Start a review' }],
    ] as const) {
      const inputPath = join(root, `${id}.json`)
      await writeFile(inputPath, JSON.stringify(input))
      const denied = await command('api', 'call', id, '--input-file', inputPath, '-o', 'json')
      expect(denied).toMatch(/\bexit=4\b/)
      expect(denied.replaceAll('\n', '')).toContain(
        // Agent sessions start runtimes only through node create (bounded spawning).
        id === 'session.launchAgent' ? 'node_create_required' : 'operation_denied',
      )
    }
    const launchFootprint = () => canvasRuntimeFootprint(page, projectId)
    const beforeLaunches = await launchFootprint()
    for (const prompt of ['logout', 'update', 'resume', 'Refactor']) {
      const denied = await command(
        'node',
        'create',
        'agent',
        '--provider',
        'codex',
        '--prompt',
        prompt,
        '-o',
        'json',
      )
      expect(denied).toMatch(/\bexit=4\b/)
      const error = denied.replaceAll('\n', '')
      expect(error).toContain('common.forbidden')
      expect(error).toContain('field_denied')
      expect(error).toContain('describe the task in a sentence')
      expect(await launchFootprint()).toEqual(beforeLaunches)
    }
    for (const prompt of ['! printenv X', '/permissions change policy', '# note', '& task']) {
      const denied = await command(
        'node',
        'create',
        'agent',
        '--provider',
        'claude-code',
        '--prompt',
        prompt,
        '-o',
        'json',
      )
      expect(denied).toMatch(/\bexit=4\b/)
      const error = denied.replaceAll('\n', '')
      expect(error).toContain('common.forbidden')
      expect(error).toContain('field_denied')
      expect(error).toContain('provider_command_prefix')
      expect(error).toContain('start with words')
      expect(await launchFootprint()).toEqual(beforeLaunches)
    }
    const nestedRefusal = await command(
      'node',
      'create',
      'agent',
      '--provider',
      'pi',
      '--prompt',
      'update',
    )
    expect(nestedRefusal).toMatch(/\bexit=4\b/)
    expect(nestedRefusal.replaceAll('\n', '')).toContain('describe the task in a sentence')
    expect(await launchFootprint()).toEqual(beforeLaunches)
    const plugin = await createCommandPlugin('single')
    pluginDirectory = plugin.directory
    await page.evaluate(
      async directory =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'plugin.install',
          payload: { directory },
        }),
      plugin.directory,
    )
    const pluginDenied = await command('plugin', 'run', plugin.id, 'inspect')
    expect(pluginDenied).toMatch(/\bexit=4\b/)
    expect(pluginDenied.replaceAll('\n', '')).toContain('plugin authority')
    expect(await readFile(record, 'utf8')).toBe(before)
    await success('node', 'delete', '--node', agentNode.id)
    await expect
      .poll(async () =>
        page.evaluate(async id => {
          const sessions = await window.opencoveApi.controlSurface.invoke<{
            sessions: { sessionId: string; status: string }[]
          }>({ kind: 'query', id: 'session.list', payload: null })
          return sessions.sessions.find(session => session.sessionId === id)?.status
        }, agentNode.sessionId),
      )
      .toBe('exited')

    const refusedStandalone = await command(
      'session',
      'run-agent',
      '--provider',
      'claude-code',
      '--prompt',
      'Start a review',
    )
    expect(refusedStandalone).toMatch(/\bexit=4\b/)
    expect(refusedStandalone.replaceAll('\n', '')).toContain('node create')
    const session = await page.evaluate(
      async targetSpaceId =>
        window.opencoveApi.controlSurface.invoke<{
          sessionId: string
          resumeSessionId: string | null
        }>({
          kind: 'command',
          id: 'session.launchAgent',
          payload: { spaceId: targetSpaceId, provider: 'claude-code', prompt: 'Start a review' },
        }),
      spaceId,
    )
    const sessionId = String(session.sessionId)
    await success('session', 'get', '--session', sessionId)
    // The strict fixture has no provider transcript; final must report truthful unavailability.
    const final = await command('session', 'final', '--session', sessionId)
    expect(final).toMatch(/\bexit=1\b/)
    expect(final.replaceAll('\n', '')).toContain('session.transcript_not_ready')
    // Seed only the isolated provider transcript, then exercise the real final-message reader.
    expect(typeof session.resumeSessionId).toBe('string')
    const sessionDetails = await object('session', 'get', '--session', sessionId)
    const transcriptDirectory = join(
      root,
      'claude',
      'projects',
      encodeClaudeProjectPath(String(sessionDetails.cwd)),
    )
    await mkdir(transcriptDirectory, { recursive: true })
    await writeFile(
      join(transcriptDirectory, `${session.resumeSessionId}.jsonl`),
      JSON.stringify({
        type: 'assistant',
        message: {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Grant transcript reply' }],
        },
      }) + '\n',
    )
    expect(await object('session', 'final', '--session', sessionId)).toMatchObject({
      message: 'Grant transcript reply',
    })
    await success('session', 'kill', '--session', sessionId)
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
      if (pluginDirectory) {
        await removePathWithRetry(pluginDirectory)
      }
    }
  }
})
