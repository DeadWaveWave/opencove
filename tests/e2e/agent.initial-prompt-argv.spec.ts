/* eslint-disable no-await-in-loop -- One PTY and receiver log require sequential commands. */
import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  promptApp,
  createCliTerminal,
  projectId,
  spaceId,
} from './agent.initial-prompt-argv.helpers'
import { openPaneContextMenuInSpace } from './workspace-canvas.arrange.shared'
import { terminalCommand, canvasRuntimeFootprint, jsonOutput } from './cli.terminal.helpers'

test('CLI grants refuse composer controls without effects and pass real launch argv to the receiver', async () => {
  const f = await promptApp()
  try {
    const binding = await createCliTerminal(f.window)
    const before = await canvasRuntimeFootprint(f.window, projectId)
    for (const [provider, prompt, message, hint] of [
      ['claude-code', 'update', 'single token', 'Rephrase the task'],
      ['pi', 'config', 'single token', 'Rephrase the task'],
      [
        'claude-code',
        'plugins\0 explain this project',
        'null character',
        'Remove the null character',
      ],
      ['codex', 'Explain\0 this project', 'null character', 'Remove the null character'],
      ['pi', '--approve this task', 'read as an option', 'Ask about the option'],
      ['codex', '/approvals', 'provider control', 'Ask about the control'],
      ['codex', '\u0085quit\u0085', 'exit alias', 'Describe your question'],
      ['codex', 'Please inspect @file', 'file reference', 'opencove fs read --uri'],
      ['codex', 'Use "$explain" please', 'skill mention', 'Paste the instructions'],
      ['codex', 'Use \\$explain please', 'skill mention', 'Paste the instructions'],
      [
        'codex',
        'Use [$explain](skill://explain) please',
        'skill mention',
        'Paste the instructions',
      ],
    ]) {
      // File input keeps quotes, Unicode, dashes and shell metacharacters out of the shell command.
      await writeFile(join(f.workspace, 'prompt.txt'), prompt)
      // Read the CLI's own output from a file: terminal rendering (ConPTY line wrapping) can
      // repeat characters at wrap boundaries, so the screen text is not a faithful copy.
      const status = await terminalCommand(
        f.window,
        binding,
        `opencove node create agent --provider ${provider} --prompt-file ./prompt.txt -o json > ./refusal.out 2>&1`,
        'PROMPT_REFUSED',
      )
      expect(status.replaceAll('\n', '')).toMatch(/\bexit=(2|4)\b/)
      // Windows PowerShell wraps a native command's redirected stderr to the console width.
      const output = collapse(decodeRedirected(await readFile(join(f.workspace, 'refusal.out'))))
      expect(output).toContain(collapse(message))
      expect(output).toContain(collapse(hint))
      expect(await canvasRuntimeFootprint(f.window, projectId)).toEqual(before)
      expect(await f.records()).toEqual([])
    }
    const prompt = 'Explain this\r\n中文 "quotes"; $value `literal`'
    await writeFile(join(f.workspace, 'prompt.txt'), prompt)
    const result = jsonOutput(
      await terminalCommand(
        f.window,
        binding,
        'opencove node create agent --provider pi --prompt-file ./prompt.txt -o json',
        'PROMPT_ACCEPTED',
      ),
    )
    expect(result).toHaveProperty('node')
    await expect.poll(f.records).toHaveLength(1)
    expect((await f.records())[0]).toMatchObject({ provider: 'pi', prompt })
    expect((await f.records())[0].command).toBeUndefined()

    // Languages written without spaces are sentences, not command tokens.
    const unspaced = '请列出当前工作目录中的文件，不要修改任何文件。'
    await writeFile(join(f.workspace, 'unspaced.txt'), unspaced)
    // Quiet output: ConPTY can garble long wide-character JSON at row wraps.
    const unspacedOutput = await terminalCommand(
      f.window,
      binding,
      'opencove node create agent --provider pi --prompt-file ./unspaced.txt -q',
      'UNSPACED_ACCEPTED',
    )
    expect(unspacedOutput).toMatch(/\bexit=0\b/)
    await expect.poll(f.records).toHaveLength(2)
    expect((await f.records())[1]).toMatchObject({ provider: 'pi', prompt: unspaced })
  } finally {
    await f.close()
  }
})

test('direct IPC and mounted control surface preserve accepted prompt operands', async () => {
  const f = await promptApp()
  try {
    for (const route of ['ipc', 'mount'] as const) {
      for (const provider of ['claude-code', 'codex', 'opencode', 'pi', 'kimi'] as const) {
        const prompt =
          provider === 'claude-code'
            ? 'cc://localhost'
            : provider === 'pi'
              ? 'Refactor'
              : '--model=other\n中文 "x"; $x'
        const count = (await f.records()).length
        await f.window.evaluate(
          async input => {
            if (input.route === 'ipc') {
              await window.opencoveApi.agent.launch({
                provider: input.provider,
                cwd: input.workspace,
                prompt: input.prompt,
                mode: 'new',
                agentFullAccess: true,
              })
            } else {
              const { mounts } = await window.opencoveApi.controlSurface.invoke<{
                mounts: { mountId: string; rootUri: string }[]
              }>({ kind: 'query', id: 'mount.list', payload: { projectId: input.projectId } })
              await window.opencoveApi.controlSurface.invoke({
                kind: 'command',
                id: 'session.launchAgentInMount',
                payload: {
                  mountId: mounts[0].mountId,
                  cwdUri: mounts[0].rootUri,
                  provider: input.provider,
                  prompt: input.prompt,
                },
              })
            }
          },
          { route, provider, prompt, workspace: f.workspace, projectId },
        )
        await expect.poll(f.records).toHaveLength(count + 1)
        const received = (await f.records()).at(-1)!
        expect(received).toMatchObject({ provider, prompt })
        expect(received.command).toBeUndefined()
        expect(received.connect).toBeUndefined()
        if (provider === 'claude-code') {
          expect(received.raw).toEqual([])
        }
      }
    }
  } finally {
    await f.close()
  }
})

test('task refusal preserves editable text, todo status and a reused live session', async () => {
  const f = await promptApp([
    {
      id: 'task',
      kind: 'task',
      title: 'Task',
      position: { x: 100, y: 100 },
      width: 460,
      height: 280,
      task: {
        requirement: 'update',
        status: 'todo',
        linkedAgentNodeId: null,
        lastRunAt: null,
        autoGeneratedTitle: false,
      },
    },
  ])
  try {
    const sidebarToggle = f.window.getByTestId('app-header-sidebar-toggle')
    await expect(sidebarToggle).toBeVisible()
    if ((await sidebarToggle.getAttribute('aria-expanded')) === 'true') {
      await sidebarToggle.click()
    }
    await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(f.window.locator('.app-shell--sidebar-collapsed')).toHaveCount(1)
    const task = f.window.locator('[data-id="task"] .task-node')
    const requirement = task.getByTestId('task-node-inline-requirement-input')
    const run = task.getByTestId('task-node-run-agent')
    const status = task.getByTestId('task-node-status-select')
    await run.click()
    await expect(requirement).toHaveValue('update')
    await expect(status).toHaveValue('todo')
    expect(await f.records()).toEqual([])
    await requirement.fill('Explain the change')
    await requirement.blur()
    await run.click()
    await expect.poll(f.records).toHaveLength(1)
    await expect(status).toHaveValue('doing')
    const before = await canvasRuntimeFootprint(f.window, projectId)
    // The control can sit outside the canvas viewport; select it with the keyboard as a user can.
    await task.getByTestId('task-node-status-step-todo').focus()
    await f.window.keyboard.press('Space')
    await expect(status).toHaveValue('todo')
    await requirement.fill('config')
    await requirement.blur()
    await run.click()
    await expect(task.getByRole('alert')).toBeVisible()
    await expect(task).toContainText('Rephrase the task')
    await expect(requirement).toHaveValue('config')
    await expect(status).toHaveValue('todo')
    expect(await canvasRuntimeFootprint(f.window, projectId)).toEqual(before)
    expect(await f.records()).toHaveLength(1)
    // Reading the old PTY still succeeds: a refused reuse did not kill it.
    const agent = await f.window.evaluate(
      async project =>
        window.opencoveApi.controlSurface.invoke<{
          nodes: { id: string; kind: string; sessionId: string }[]
        }>({ kind: 'query', id: 'node.list', payload: { projectId: project, kind: 'agent' } }),
      projectId,
    )
    const target = agent.nodes.find(node => node.kind === 'agent')!
    await expect(
      f.window.evaluate(
        async id => window.opencoveApi.pty.snapshot({ sessionId: id }),
        target.sessionId,
      ),
    ).resolves.toBeTruthy()
  } finally {
    await f.close()
  }
})

test('role prompts use the same refusal and accepted argv policy', async () => {
  const f = await promptApp()
  try {
    const pane = f.window.locator('.workspace-canvas .react-flow__pane')
    await openPaneContextMenuInSpace(f.window, pane, spaceId)
    await f.window.getByTestId('workspace-context-run-role').click()
    await f.window.getByTestId('workspace-context-new-role').click()
    await f.window.getByTestId('workspace-role-name-input').fill('Reviewer')
    await f.window.getByTestId('workspace-role-prompt-input').fill('update')
    await f.window.getByTestId('workspace-role-create').click()
    const role = f.window.locator('.role-node').first()
    await expect(role).toBeVisible()
    await role.getByTestId('role-node-run').click()
    await expect(role).toContainText('Rephrase the task')
    expect(await f.records()).toEqual([])
    await role.getByTestId('role-node-input').fill('Review the change')
    await role.getByTestId('role-node-run').click()
    await expect.poll(f.records).toHaveLength(1)
    expect((await f.records())[0].prompt).toBe('update\n\nUser input:\nReview the change')
    // Pi has no verified resume binding here; reload is an explicit new launch of stored text.
    const agent = f.window.locator('.terminal-node').first()
    await expect(agent.getByTestId('terminal-node-reload-session')).toBeEnabled()
    await agent.getByTestId('terminal-node-reload-session').click()
    await expect.poll(f.records).toHaveLength(2)
    expect((await f.records())[1].prompt).toBe('update\n\nUser input:\nReview the change')
  } finally {
    await f.close()
  }
})

/** Windows PowerShell 5.1 redirects as UTF-16LE with a BOM; other shells write UTF-8. */
function decodeRedirected(bytes: Buffer): string {
  return bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.subarray(2).toString('utf16le')
    : bytes.toString('utf8')
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ')
}
