/* eslint-disable no-await-in-loop -- terminal sessions are spawned sequentially for stable profiling */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function seedProfileUserData({ userDataDir, repoPath }) {
  await writeFile(
    path.join(userDataDir, 'approved-workspaces.json'),
    `${JSON.stringify({ version: 1, roots: [repoPath] })}\n`,
    'utf8',
  )
}

function createWorkspaceState({ repoPath, nodes }) {
  const workspaceId = 'workspace-terminal-load-profile'
  const spaceId = 'workspace-terminal-load-profile-main'

  return {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: 'terminal load profile',
        path: repoPath,
        worktreesRoot: path.join(repoPath, '.opencove', 'worktrees'),
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 0.8 },
        isMinimapVisible: true,
        spaces: [
          {
            id: spaceId,
            name: 'Main',
            directoryPath: repoPath,
            targetMountId: null,
            labelColor: null,
            nodeIds: nodes.map(node => node.id),
            rect: null,
          },
        ],
        activeSpaceId: spaceId,
        nodes,
      },
    ],
    settings: {
      standardWindowSizeBucket: 'regular',
      terminalFontSize: 13,
      terminalFontFamily: null,
      defaultTerminalWindowScalePercent: 80,
      disableAppShortcutsWhenTerminalFocused: true,
      focusNodeOnClick: true,
    },
  }
}

export async function seedWorkspace(window, { repoPath, nodes }) {
  const state = createWorkspaceState({ repoPath, nodes })
  const result = await window.evaluate(async rawState => {
    window.localStorage.removeItem('opencove:m5.6:view-state')
    return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
      raw: JSON.stringify(rawState),
    })
  }, state)

  if (!result?.ok) {
    throw new Error(`[terminal-load-profile] failed to seed workspace: ${JSON.stringify(result)}`)
  }

  await window.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
}

export async function waitForWorkspace(window) {
  await window.locator('.app-startup-state').waitFor({ state: 'detached', timeout: 60_000 })
  await window.locator('.workspace-canvas .react-flow__pane').waitFor({
    state: 'visible',
    timeout: 60_000,
  })
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function quotePosix(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function createStubLaunchCommand(input) {
  const args = [
    input.nodeExecutable,
    input.stubPath,
    String(input.index),
    String(input.outputIntervalMs),
    String(input.outputPayloadBytes),
    String(input.durationMs),
  ]

  if (process.platform === 'win32') {
    const [command, ...commandArgs] = args
    return `& ${quotePowerShell(command)} ${commandArgs.map(quotePowerShell).join(' ')}`
  }

  return args.map(quotePosix).join(' ')
}

export async function spawnTerminalSessions(
  window,
  { repoPath, terminalCount, outputIntervalMs, outputPayloadBytes, sampleDurationMs },
) {
  const stubPath = path.join(repoPath, 'scripts', 'profile-terminal-output-stub.mjs')
  const sessions = []

  for (let index = 0; index < terminalCount; index += 1) {
    const result = await window.evaluate(
      async input => {
        return await window.opencoveApi.pty.spawn({
          cwd: input.cwd,
          cols: 80,
          rows: 24,
        })
      },
      { cwd: repoPath },
    )

    if (!result?.sessionId) {
      throw new Error(
        `[terminal-load-profile] failed to spawn terminal ${index}: ${JSON.stringify(result)}`,
      )
    }

    const commandLine = createStubLaunchCommand({
      nodeExecutable: process.execPath,
      stubPath,
      index,
      outputIntervalMs,
      outputPayloadBytes,
      durationMs: sampleDurationMs + 30_000,
    })
    await window.evaluate(
      async input => {
        await window.opencoveApi.pty.write({
          sessionId: input.sessionId,
          data: `${input.commandLine}\r`,
          encoding: 'utf8',
        })
      },
      { sessionId: result.sessionId, commandLine },
    )

    sessions.push(result.sessionId)
  }

  return sessions
}

export function createNodes(sessionIds, { repoPath }) {
  return sessionIds.map((sessionId, index) => {
    const column = index % 5
    const row = Math.floor(index / 5)
    return {
      id: `profile-terminal-${String(index + 1).padStart(2, '0')}`,
      sessionId,
      title: `profile terminal ${index + 1}`,
      titlePinnedByUser: false,
      position: { x: 100 + column * 360, y: 100 + row * 300 },
      width: 340,
      height: 260,
      kind: 'terminal',
      profileId: null,
      runtimeKind: process.platform === 'win32' ? 'windows' : 'posix',
      terminalGeometry: { cols: 80, rows: 24 },
      terminalProviderHint: null,
      labelColorOverride: null,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: repoPath,
      expectedDirectory: repoPath,
      agent: null,
      task: null,
    }
  })
}
