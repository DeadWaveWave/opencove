import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { AcceptanceFailures } from './agent.prompt.real-codex.daemon.failures'
import {
  parseProcessRows,
  collectProcessTree,
  createProcessOwnership,
  classifyRemainingAgentProcesses,
  type ProcessRow,
} from './agent.prompt.real-codex.daemon.processes'
import { cli } from './agent.prompt.real-codex.helpers'

const exec = promisify(execFile)

interface AgentProcessSnapshot {
  rootPid: number
  daemonPid: number
  agentTree: ProcessRow[]
  daemonTree: ProcessRow[]
  codexHome: string
  workspace: string
  agentProcessGroups: number[]
  agentSessions: string[]
}

export const slowToolSeconds = 30

async function readProcesses(timeout = 5_000): Promise<ProcessRow[]> {
  const { stdout } = await exec('ps', ['-ww', '-axo', 'pid=,ppid=,pgid=,sess=,command='], {
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  })
  return parseProcessRows(stdout, true)
}

export async function startSlowTool(page: Page, nodeId: string): Promise<void> {
  await dismissNotifications(page)
  const input = page.locator(`.react-flow__node[data-id="${nodeId}"] .xterm-helper-textarea`)
  await input.click()
  // Direct user input also works for the deliberately unpromptable daemon-reuse case.
  // Type at human speed: Codex treats a fast burst of keys as a paste, and an Enter inside a
  // paste burst inserts a newline instead of submitting.
  await page.keyboard.type('SLOW_TOOL keep a child alive while this node closes', { delay: 30 })
  await page.keyboard.press('Enter')
}

async function resolveAgentRootPid(sessionId: string): Promise<number> {
  // PTY metadata currently exposes only sessionId, not node-pty's rootPid. The hosting
  // runtime injects OPENCOVE_SESSION_ID into the PTY root and descendants (entry.ts).
  // Read that exact identity, never guess from a Codex name, cwd, or daemon ancestry.
  const { stdout } = await exec('ps', ['axeww', '-o', 'pid=,ppid=,pgid=,command='], {
    timeout: 1_000,
    maxBuffer: 32 * 1024 * 1024,
  }).catch(() => {
    // Child-process errors may carry captured stdout containing environment credentials.
    throw new Error('Unable to resolve the PTY root from runtime session identity')
  })
  const identity = `OPENCOVE_SESSION_ID=${sessionId}`
  const rows = parseProcessRows(stdout, false)
  const matching = rows.filter(row => row.command.split(/\s+/u).includes(identity))
  const byPid = new Map(rows.map(row => [row.pid, row]))
  const matchingPids = new Set(matching.map(row => row.pid))
  const roots = matching.filter(row => {
    const visited = new Set<number>([row.pid])
    let parent = byPid.get(row.ppid)
    while (parent && !visited.has(parent.pid)) {
      if (matchingPids.has(parent.pid)) {
        return false
      }
      visited.add(parent.pid)
      parent = byPid.get(parent.ppid)
    }
    return true
  })
  // Never attach ps environment output: it can contain credentials. Only record numeric identity.
  expect(
    roots.map(row => row.pid),
    'Exactly one PTY root must carry the runtime session identity',
  ).toHaveLength(1)
  return roots[0].pid
}

export async function snapshotAgentProcesses(options: {
  sessionId: string
  daemonPid: number | undefined
  codexHome: string
  workspace: string
  testInfo: TestInfo
  /** With daemon reuse the tool runs under the shared daemon, not under the agent PTY. */
  requireToolChild: boolean
}): Promise<AgentProcessSnapshot> {
  const { sessionId, daemonPid, codexHome, workspace, testInfo, requireToolChild } = options
  if (typeof daemonPid !== 'number' || !Number.isSafeInteger(daemonPid) || daemonPid <= 0) {
    throw new Error('daemon start must identify its running pid')
  }
  const rootPid = await resolveAgentRootPid(sessionId)
  let rows: ProcessRow[] = await readProcesses()
  await expect
    .poll(
      async () => {
        rows = await readProcesses()
        if (!requireToolChild) {
          return true
        }
        return collectProcessTree(rows, rootPid).some(row =>
          new RegExp(`^(?:\\S*/)?sleep\\s+${slowToolSeconds}(?:\\s|$)`, 'u').test(
            row.command.trim(),
          ),
        )
      },
      {
        timeout: 10_000,
        intervals: [100],
        message: 'The real Codex tool must have a live sleep child before closing',
      },
    )
    .toBe(true)
  const agentTree = collectProcessTree(rows, rootPid)
  const daemonTree = collectProcessTree(rows, daemonPid)
  expect(
    agentTree.some(row => row.pid === rootPid),
    'PTY root must still be live before closing',
  ).toBe(true)
  expect(
    daemonTree.some(row => row.pid === daemonPid),
    'shared daemon root must be live',
  ).toBe(true)
  const daemonPids = new Set(daemonTree.map(row => row.pid))
  expect(
    agentTree.filter(row => daemonPids.has(row.pid)),
    'Agent and shared daemon trees must be disjoint',
  ).toEqual([])
  const ownership = createProcessOwnership({ agentTree, daemonTree, daemonPid })
  const snapshot = {
    rootPid,
    daemonPid,
    agentTree,
    daemonTree,
    codexHome,
    workspace,
    agentProcessGroups: [...ownership.agentGroups],
    agentSessions: [...ownership.agentSessions],
  }
  await testInfo.attach('process-trees-before-close', {
    body: JSON.stringify(snapshot, null, 2),
    contentType: 'application/json',
  })
  return snapshot
}

export async function assertAgentProcessesGone(
  snapshot: AgentProcessSnapshot,
  testInfo: TestInfo,
): Promise<void> {
  const ownership = createProcessOwnership(snapshot)
  const deadline = performance.now() + 5_000
  let remaining: ProcessRow[] = []
  try {
    while (performance.now() < deadline) {
      // Sequential samples preserve the bounded lifecycle observation order.
      // eslint-disable-next-line no-await-in-loop
      const rows = await readProcesses(Math.max(1_000, Math.floor(deadline - performance.now())))
      remaining = classifyRemainingAgentProcesses(rows, ownership)
      if (remaining.length === 0) {
        return
      }
      // eslint-disable-next-line no-await-in-loop
      await delay(Math.min(100, Math.max(0, deadline - performance.now())))
    }
    expect(
      remaining,
      'Agent processes, including tool commands it started, must disappear within 5s of closing; shared daemon is excluded',
    ).toEqual([])
  } catch (error) {
    const failures = new AcceptanceFailures()
    failures.add('process cleanup', error)
    await failures.capture(
      'remaining process attachment',
      async () =>
        await testInfo.attach('remaining-agent-processes', {
          body: JSON.stringify(remaining, null, 2),
          contentType: 'application/json',
        }),
    )
    failures.throwIfAny()
  }
}

async function dismissNotifications(page: Page): Promise<void> {
  // A finished turn raises completion notifications that can cover the window header;
  // dismiss them the way workspace-canvas.agent-status-watcher.spec.ts does.
  const notificationClose = page.locator('[data-testid^="app-notification-close-"]')
  // eslint-disable-next-line no-await-in-loop -- count the freshly rendered stack each time
  while ((await notificationClose.count()) > 0) {
    // eslint-disable-next-line no-await-in-loop -- each dismissal re-renders the stack
    await notificationClose.first().click()
  }
}

export async function endAgentNode(
  page: Page,
  userDataDir: string,
  nodeId: string,
  ending: 'close' | 'delete',
): Promise<void> {
  if (ending === 'close') {
    await dismissNotifications(page)
    // Same header-close path as workspace-canvas.agent-sidebar.spec.ts.
    await page.locator(`.react-flow__node[data-id="${nodeId}"] .terminal-node__close`).click()
  } else {
    // Same CLI deletion path as agent.turn-archive.spec.ts.
    const deleted = await cli(userDataDir, ['node', 'delete', '--node', nodeId])
    expect(deleted.exitCode, JSON.stringify(deleted)).toBe(0)
  }
}

export async function socketReachable(socketPath: string): Promise<boolean> {
  return await new Promise(resolve => {
    const socket = connect(socketPath)
    const finish = (reachable: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(reachable)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1_000, () => finish(false))
  })
}
