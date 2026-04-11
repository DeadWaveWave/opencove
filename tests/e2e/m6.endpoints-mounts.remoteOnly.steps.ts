import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { GetSessionResult } from '../../src/shared/contracts/dto'
import { buildNodeEvalCommand } from './workspace-canvas.helpers'
import { pollFor } from './m6.endpoints-mounts.integration.helpers'

async function openWorkspacePaneContextMenu(pane: Locator): Promise<void> {
  const position = await pane.evaluate(paneEl => {
    const paneRect = paneEl.getBoundingClientRect()
    const blocks = Array.from(
      document.querySelectorAll(
        '.terminal-node, .task-node, .note-node, .website-node, .workspace-canvas__space',
      ),
    ).map(el => el.getBoundingClientRect())

    const paneWidth = Math.max(0, paneRect.width)
    const paneHeight = Math.max(0, paneRect.height)
    const margin = 28

    const candidates = [
      { x: margin, y: margin },
      { x: paneWidth - margin, y: margin },
      { x: margin, y: paneHeight - margin },
      { x: paneWidth - margin, y: paneHeight - margin },
      { x: paneWidth / 2, y: margin },
      { x: margin, y: paneHeight / 2 },
    ].filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))

    const isBlocked = (absX: number, absY: number): boolean =>
      blocks.some(
        rect =>
          absX >= rect.x &&
          absX <= rect.x + rect.width &&
          absY >= rect.y &&
          absY <= rect.y + rect.height,
      )

    for (const point of candidates) {
      const absX = paneRect.x + point.x
      const absY = paneRect.y + point.y
      if (!isBlocked(absX, absY)) {
        return { x: point.x, y: point.y }
      }
    }

    return { x: margin, y: margin }
  })

  await pane.click({ button: 'right', position })
}

export async function verifyRemoteOnlyProjectDefaultMount({
  window,
  projectName,
  remoteEndpointId,
  remoteOnlyDir,
  remoteOnlyDirHashes,
}: {
  window: Page
  projectName: string
  remoteEndpointId: string
  remoteOnlyDir: string
  remoteOnlyDirHashes: ReadonlySet<string>
}): Promise<void> {
  const remoteOnlySidebarItem = window
    .locator('.workspace-sidebar [data-testid^="workspace-item-"]')
    .filter({ hasText: projectName })
    .first()
  await expect(remoteOnlySidebarItem).toBeVisible()

  const remoteOnlyProjectId = await pollFor(
    async () =>
      await window.evaluate(async name => {
        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        if (!raw) {
          return null
        }

        try {
          const parsed = JSON.parse(raw) as {
            workspaces?: Array<{ id?: string; name?: string }>
          }
          const workspace = parsed.workspaces?.find(candidate => candidate?.name === name) ?? null
          return typeof workspace?.id === 'string' ? workspace.id : null
        } catch {
          return null
        }
      }, projectName),
    { label: 'remote-only project id' },
  )

  const remoteOnlyMountId = await pollFor(
    async () =>
      await window.evaluate(
        async ({ projectId, endpointId }) => {
          const mountResult = await window.opencoveApi.controlSurface.invoke<{
            mounts: Array<{ mountId: string; endpointId: string }>
          }>({
            kind: 'query',
            id: 'mount.list',
            payload: { projectId },
          })
          const match = mountResult.mounts.find(mount => mount.endpointId === endpointId) ?? null
          return match?.mountId ?? null
        },
        { projectId: remoteOnlyProjectId, endpointId: remoteEndpointId },
      ),
    { label: 'remote-only mount id' },
  )

  await remoteOnlySidebarItem.click({ noWaitAfter: true })

  const pane = window.locator('.workspace-canvas .react-flow__pane')
  await expect(pane).toBeVisible()

  await openWorkspacePaneContextMenu(pane)
  await window.locator('[data-testid="workspace-context-new-terminal"]').click()
  await expect(window.locator('.terminal-node')).toHaveCount(1)

  const remoteOnlyTerminal = window.locator('.terminal-node').first()
  await expect(remoteOnlyTerminal.locator('.xterm')).toBeVisible()
  await remoteOnlyTerminal.locator('.xterm').click()

  await expect(remoteOnlyTerminal.locator('.xterm-helper-textarea')).toBeFocused()
  await window.waitForTimeout(250)

  const remoteOnlyCwdToken = `OPENCOVE_M6_REMOTE_ONLY_CWD_SHA_${Date.now()}:`
  await window.keyboard.type(
    buildNodeEvalCommand(
      `const crypto = require('crypto')\n` +
        `const digest = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12)\n` +
        `process.stdout.write(${JSON.stringify(remoteOnlyCwdToken)} + digest + '\\n')`,
    ),
  )
  await window.keyboard.press('Enter')
  await expect
    .poll(async () => {
      const text = (await remoteOnlyTerminal.textContent()) ?? ''
      return [...remoteOnlyDirHashes].some(hash => text.includes(`${remoteOnlyCwdToken}${hash}`))
    })
    .toBe(true)

  await openWorkspacePaneContextMenu(pane)
  const terminalCountBeforeAgent = await window.locator('.terminal-node').count()
  await window.locator('[data-testid="workspace-context-run-default-agent"]').click()
  await expect(window.locator('.terminal-node')).toHaveCount(terminalCountBeforeAgent + 1)

  const agentNode = window.locator('.terminal-node').nth(terminalCountBeforeAgent)
  await expect(agentNode).toContainText('[opencove-test-agent]')

  const agentSessionId = await pollFor(
    async () =>
      await window.evaluate(async () => {
        return window.__opencoveWorkspaceCanvasTestApi?.getFirstAgentSessionId?.() ?? null
      }),
    { timeoutMs: 20_000, label: 'remote-only agent session id' },
  )

  const session = await window.evaluate(async sessionId => {
    return await window.opencoveApi.controlSurface.invoke<GetSessionResult>({
      kind: 'query',
      id: 'session.get',
      payload: { sessionId },
    })
  }, agentSessionId)

  expect(session.executionContext.endpoint.endpointId).toBe(remoteEndpointId)
  expect(session.executionContext.mountId).toBe(remoteOnlyMountId)
  expect(session.executionContext.target.rootPath).toBe(remoteOnlyDir)

  const sessionsBeforeTaskAgent = await window.evaluate(async () => {
    return window.__opencoveWorkspaceCanvasTestApi?.getAgentSessions?.() ?? []
  })

  await openWorkspacePaneContextMenu(pane)
  await window.locator('[data-testid="workspace-context-new-task"]').click()
  await expect(window.locator('[data-testid="workspace-task-creator"]')).toBeVisible()
  await window
    .locator('[data-testid="workspace-task-requirement"]')
    .fill('Remote-only task agent should run in default mount')
  await window.locator('[data-testid="workspace-task-create-submit"]').click()
  await expect(window.locator('[data-testid="workspace-task-creator"]')).toHaveCount(0)

  const taskNode = window.locator('.task-node').first()
  await expect(taskNode).toBeVisible()
  await taskNode.locator('[data-testid="task-node-run-agent"]').click()

  const taskAgentSessionId = await pollFor(
    async () =>
      await window.evaluate(
        async ({ previous }) => {
          const next = window.__opencoveWorkspaceCanvasTestApi?.getAgentSessions?.() ?? []
          const previousIds = new Set(
            (previous ?? []).map((item: { sessionId: string }) => item.sessionId),
          )
          const created =
            next.find((item: { sessionId: string }) => !previousIds.has(item.sessionId)) ?? null
          return created?.sessionId ?? null
        },
        { previous: sessionsBeforeTaskAgent },
      ),
    { timeoutMs: 20_000, label: 'remote-only task agent session id' },
  )

  const taskSession = await window.evaluate(async sessionId => {
    return await window.opencoveApi.controlSurface.invoke<GetSessionResult>({
      kind: 'query',
      id: 'session.get',
      payload: { sessionId },
    })
  }, taskAgentSessionId)

  expect(taskSession.executionContext.endpoint.endpointId).toBe(remoteEndpointId)
  expect(taskSession.executionContext.mountId).toBe(remoteOnlyMountId)
  expect(taskSession.executionContext.target.rootPath).toBe(remoteOnlyDir)
}
