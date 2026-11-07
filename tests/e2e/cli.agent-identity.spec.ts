import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'

const projectId = 'cli-identity-project'
const mainSpaceId = 'cli-identity-main'
const otherSpaceId = 'cli-identity-other'
const briefId = 'cli-identity-brief'

// Construct markers in the shell: neither complete marker occurs in the echoed input.
function printMarker(suffix: string): string {
  return process.platform === 'win32'
    ? `Write-Output ('OC_CLI_' + '${suffix}')`
    : `printf '\n%s%s\n' 'OC_CLI_' '${suffix}'`
}

async function terminalCommand(
  page: Page,
  binding: { nodeId: string; sessionId: string },
  command: string,
  label: string,
): Promise<string> {
  const nonce = randomUUID().replaceAll('-', '')
  const begin = `${label}_BEGIN_${nonce}`
  const end = `${label}_END_${nonce}`
  // Capture the CLI process status immediately, before printing the end marker.
  const status =
    process.platform === 'win32' ? 'Write-Output ("exit=" + $LASTEXITCODE)' : 'echo "exit=$?"'
  const input = [printMarker(begin), command, status, printMarker(end)].join('; ')
  const accepted = await page.evaluate(
    async payload => {
      return await window.opencoveApi.controlSurface.invoke<{ accepted: boolean }>({
        kind: 'command',
        id: 'session.writeNode',
        payload: { ...payload.binding, data: payload.input + '\r' },
      })
    },
    { binding, input },
  )
  expect(accepted.accepted, `${label}: session.writeNode must accept the live binding`).toBe(true)

  let output = ''
  await expect
    .poll(
      async () => {
        const raw = await page.evaluate(async sessionId => {
          return (await window.opencoveApi.pty.snapshot({ sessionId })).data
        }, binding.sessionId)
        output = stripVTControlCharacters(raw).replaceAll('\r', '')
        const start = output.lastIndexOf(`OC_CLI_${begin}`)
        return start >= 0 && output.indexOf(`OC_CLI_${end}`, start) > start
      },
      {
        timeout: 20_000,
        intervals: [100, 250, 500],
        message: `${label}: CLI output must complete between shell-assembled markers (not command echo)`,
      },
    )
    .toBe(true)
  const start = output.lastIndexOf(`OC_CLI_${begin}`) + `OC_CLI_${begin}`.length
  return output.slice(start, output.indexOf(`OC_CLI_${end}`, start)).trim()
}

function jsonOutput(output: string): Record<string, unknown> {
  expect(output, 'Read-only CLI command must exit successfully').toMatch(/\bexit=0\b/)
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  expect(start, `Expected CLI JSON in framed terminal output: ${output}`).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  // ConPTY may wrap a compact JSON value across physical console rows.
  return JSON.parse(output.slice(start, end + 1).replaceAll('\n', '')) as Record<string, unknown>
}

test('a canvas terminal discovers its identity, neighbors and scope through the CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-identity-'))
  const workspace = join(root, 'project')
  const profile = join(root, 'profile')
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const launched = await launchApp({
      userDataDir: profile,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        // Let the app own its isolated local Worker and its shutdown lifecycle.
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      workspaces: [
        {
          id: projectId,
          name: 'CLI identity project',
          path: workspace,
          activeSpaceId: mainSpaceId,
          nodes: [
            {
              id: briefId,
              kind: 'note',
              title: 'Brief',
              position: { x: 80, y: 90 },
              width: 280,
              height: 180,
              task: { text: 'Orient yourself in Main before acting.' },
            },
          ],
          spaces: [
            {
              id: mainSpaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [briefId],
              rect: { x: 20, y: 20, width: 1300, height: 800 },
            },
            {
              id: otherSpaceId,
              name: 'Other',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 1500, y: 20, width: 600, height: 500 },
            },
          ],
        },
      ],
    })

    // Do not seed a terminal/session or inject identity variables: creation must issue P1-A's grant.
    const created = await page.evaluate(
      async payload => {
        return await window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: payload.spaceId },
            title: 'Agent CLI terminal',
            frame: { x: 420, y: 120, width: 760, height: 540 },
            data: { shell: payload.shell },
          },
        })
      },
      { spaceId: mainSpaceId, shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' },
    )
    expect(created.projectId).toBe(projectId)
    expect(created.spaceId).toBe(mainSpaceId)
    const nodeId = created.node.id
    const sessionId = created.node.sessionId
    expect(sessionId, 'node.create must return a real PTY session').toBeTruthy()
    if (!sessionId) {
      throw new Error('Created terminal has no session ID')
    }
    const binding = { nodeId, sessionId }
    const terminal = page.locator(`[data-id="${nodeId}"] .terminal-node`)
    await expect(terminal, 'Created terminal must reach the canvas').toBeVisible({
      timeout: 15_000,
    })
    await expect(
      terminal.locator('.terminal-node__terminal'),
      'PTY must be ready for input',
    ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })

    const identity = jsonOutput(await terminalCommand(page, binding, 'opencove whoami', 'WHOAMI'))
    expect(identity).toEqual({
      caller: 'session-grant',
      scope: 'interact',
      projectId,
      spaceId: mainSpaceId,
      nodeId,
      sessionId,
    })
    expect(identity).not.toHaveProperty('token')

    const context = jsonOutput(await terminalCommand(page, binding, 'opencove context', 'CONTEXT'))
    expect(context).toMatchObject({
      self: { caller: 'session-grant', projectId, spaceId: mainSpaceId, nodeId },
      project: { id: projectId, name: 'CLI identity project', path: workspace },
      space: { id: mainSpaceId, name: 'Main', directory: workspace },
    })
    expect(context.nodes).toEqual([{ id: briefId, kind: 'note', title: 'Brief', state: null }])
    expect((context.nodes as { id: string }[]).some(node => node.id === nodeId)).toBe(false)

    const self = jsonOutput(
      await terminalCommand(page, binding, 'opencove node get --node "@self" --fields id', 'SELF'),
    )
    expect(self).toEqual({ node: { id: nodeId } })

    // The server checks admin scope before payload validation. If the scope fence regresses,
    // this empty payload still cannot approve an unrelated filesystem root.
    const denied = await terminalCommand(
      page,
      binding,
      "opencove api call workspace.approveRoot --input '{}' -o json",
      'SCOPE',
    )
    expect(denied).toMatch(/\bexit=4\b/)
    expect(denied).toContain('common.forbidden')
    expect(denied).toContain('An OpenCove session may read and interact')
    expect(denied).toContain('outside the OpenCove session')
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
