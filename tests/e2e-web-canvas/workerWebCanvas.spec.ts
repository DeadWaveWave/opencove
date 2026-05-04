import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  fileUri,
  openAuthedCanvas,
  readSharedState,
  readTextFile,
  webCanvasBaseUrl,
  writeAppState,
  writeTextFile,
  invokeValue,
} from './helpers'

async function clickHeaderDragSurfaceByTestId(
  page: import('@playwright/test').Page,
  testId: string,
): Promise<void> {
  await page.getByTestId(testId).first().click()
}

test.describe('Worker web canvas', () => {
  test('opens the full canvas via ticket claim without leaving a token in the URL', async ({
    page,
  }) => {
    const workspacePath = await createWorkspaceDir('full-canvas-auth')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        workspaceName: 'full-web-demo',
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 180, y: 180 },
            width: 360,
            height: 260,
            text: 'hello from full web canvas',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    await expect(page).toHaveTitle('full-web-demo — OpenCove')
    await expect(page.locator('.workspace-canvas')).toBeVisible()
    await expect(page.locator('[data-testid="note-node-textarea"]').first()).toHaveValue(
      'hello from full web canvas',
    )

    const currentUrl = new URL(page.url())
    expect(currentUrl.origin).toBe(webCanvasBaseUrl)
    expect(currentUrl.pathname).toBe('/')
    expect(currentUrl.searchParams.get('token')).toBeNull()
  })

  test('creates notes from the web UI and applies external sync updates without reload', async ({
    page,
  }) => {
    const workspacePath = await createWorkspaceDir('note-sync')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['anchor-note'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'anchor-note',
            title: 'note',
            kind: 'note',
            position: { x: 80, y: 80 },
            width: 240,
            height: 180,
            text: 'keep space',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: 560, y: 220 } })
    const newNoteButton = page.locator('[data-testid="workspace-context-new-note"]')
    await expect(newNoteButton).toBeVisible()
    await newNoteButton.click()

    const localNote = page.locator('[data-testid="note-node-textarea"]').last()
    await expect(localNote).toBeVisible()
    await localNote.fill('created from web ui')

    await expect
      .poll(async () => {
        const shared = await readSharedState(page.request)
        return shared.state?.workspaces[0]?.nodes.filter(node => node.kind === 'note').length ?? 0
      })
      .toBe(2)

    await invokeValue(page.request, 'command', 'note.create', {
      spaceId: 'space-1',
      text: 'created from external sync',
      x: 520,
      y: 180,
    })

    await expect
      .poll(async () => {
        return await page
          .locator('[data-testid="note-node-textarea"]')
          .evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))
      })
      .toContain('created from external sync')
  })

  test('does not rollback local note edits while applying sync refreshes', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('note-no-rollback')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['note-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'note-1',
            title: 'note',
            kind: 'note',
            position: { x: 80, y: 80 },
            width: 240,
            height: 180,
            text: 'initial',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const localDraft = `local-${'x'.repeat(8000)}`
    const textarea = page.locator('[data-testid="note-node-textarea"]').first()
    await expect(textarea).toBeVisible()
    await textarea.fill(localDraft)

    await invokeValue(page.request, 'command', 'note.create', {
      spaceId: 'space-1',
      text: 'external refresh note',
      x: 520,
      y: 180,
    })

    await expect
      .poll(async () => {
        return await page
          .locator('[data-testid="note-node-textarea"]')
          .evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))
      })
      .toContain('external refresh note')

    await expect
      .poll(async () => {
        return await page
          .locator('[data-testid="note-node-textarea"]')
          .evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))
      })
      .toContain(localDraft)
  })

  test('preserves local selection while applying sync refreshes', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('selection-refresh')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['anchor-note'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'anchor-note',
            title: 'note',
            kind: 'note',
            position: { x: 80, y: 80 },
            width: 240,
            height: 180,
            text: 'keep space',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await pane.click({ button: 'right', position: { x: 560, y: 220 } })
    await page.locator('[data-testid="workspace-context-new-terminal"]').click()

    const terminal = page.locator('.terminal-node').first()
    await expect(terminal).toBeVisible()
    await expect(terminal.locator('.xterm')).toBeVisible()
    const terminalWrapper = page.locator('.react-flow__node').filter({ has: terminal }).first()

    const terminalHeader = terminal.locator('.terminal-node__header')
    await expect(terminalHeader).toBeVisible()
    await clickHeaderDragSurfaceByTestId(page, 'terminal-node-header-drag-surface')

    await expect(terminalWrapper).toHaveClass(/selected/)

    const sharedBeforeRefresh = await readSharedState(page.request)
    expect(sharedBeforeRefresh.state?.workspaces?.length).toBeGreaterThan(0)
    const currentState = sharedBeforeRefresh.state
    expect(currentState).toBeTruthy()

    const newNoteId = `external-note-${Date.now()}`
    const nextState = JSON.parse(JSON.stringify(currentState)) as NonNullable<typeof currentState>
    const targetWorkspace = nextState.workspaces[0]
    const targetSpace = targetWorkspace.spaces.find(space => space.id === 'space-1')
    expect(targetSpace).toBeTruthy()

    targetWorkspace.nodes.push({
      id: newNoteId,
      title: 'note',
      titlePinnedByUser: false,
      position: { x: 520, y: 180 },
      width: 360,
      height: 260,
      kind: 'note',
      labelColorOverride: null,
      profileId: null,
      runtimeKind: null,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: null,
      expectedDirectory: null,
      agent: null,
      task: {
        text: 'external refresh note',
      },
    })
    targetSpace!.nodeIds.push(newNoteId)

    await writeAppState(page.request, nextState)

    await expect(terminalWrapper).toHaveClass(/selected/)
  })

  test('saves document edits through the worker-backed filesystem', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('document-save')
    const documentPath = `${workspacePath}/readme.md`
    await writeTextFile(documentPath, '# original\n')

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['doc-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'doc-1',
            title: 'readme.md',
            kind: 'document',
            position: { x: 240, y: 180 },
            width: 420,
            height: 320,
            uri: fileUri(documentPath),
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const textarea = page.locator('[data-testid="document-node-textarea"]').first()
    await expect(textarea).toBeVisible()
    await textarea.fill('# saved from web canvas\n')
    await page.getByRole('button', { name: 'Save' }).first().click()

    await expect
      .poll(async () => await readTextFile(documentPath))
      .toBe('# saved from web canvas\n')
  })

  test('reconnects terminal sessions after a page reload', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('terminal-reconnect')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: [],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await pane.click({ button: 'right', position: { x: 240, y: 180 } })
    await page.locator('[data-testid="workspace-context-new-terminal"]').click()

    const terminal = page.locator('.terminal-node').first()
    await expect(terminal).toBeVisible()
    await expect(terminal.locator('.xterm')).toBeVisible()

    const firstToken = `WEB_RECONNECT_${Date.now()}`
    await terminal.locator('.xterm').click()
    await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
    await page.keyboard.type(`echo ${firstToken}`)
    await page.keyboard.press('Enter')
    await expect(terminal).toContainText(firstToken)

    await page.reload({ waitUntil: 'domcontentloaded' })

    const reloadedTerminal = page.locator('.terminal-node').first()
    await expect(reloadedTerminal).toBeVisible()
    await expect(reloadedTerminal.locator('.xterm')).toBeVisible()
    await expect(reloadedTerminal).toContainText(firstToken)

    const secondToken = `WEB_AFTER_RELOAD_${Date.now()}`
    await reloadedTerminal.locator('.xterm').click()
    await expect(reloadedTerminal.locator('.xterm-helper-textarea')).toBeFocused()
    await page.keyboard.type(`echo ${secondToken}`)
    await page.keyboard.press('Enter')
    await expect(reloadedTerminal).toContainText(secondToken)
  })

  test('allows controlling a shared terminal session from multiple web clients', async ({
    browser,
    page,
  }) => {
    const workspacePath = await createWorkspaceDir('terminal-multi-client')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: [],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await pane.click({ button: 'right', position: { x: 240, y: 180 } })
    await page.locator('[data-testid="workspace-context-new-terminal"]').click()

    const terminal = page.locator('.terminal-node').first()
    await expect(terminal).toBeVisible()
    await expect(terminal.locator('.xterm')).toBeVisible()

    const firstToken = `WEB_MULTI_CLIENT_${Date.now()}`
    await terminal.locator('.xterm').click()
    await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
    await page.keyboard.type(`echo ${firstToken}`)
    await page.keyboard.press('Enter')
    await expect(terminal).toContainText(firstToken)

    const secondContext = await browser.newContext({ baseURL: webCanvasBaseUrl })
    const secondPage = await secondContext.newPage()

    try {
      await openAuthedCanvas(secondPage)

      const secondTerminal = secondPage.locator('.terminal-node').first()
      await expect(secondTerminal).toBeVisible()
      await expect(secondTerminal.locator('.xterm')).toBeVisible()

      const secondToken = `WEB_MULTI_CLIENT_2_${Date.now()}`
      await secondTerminal.locator('.xterm').click()
      await expect(secondTerminal.locator('.xterm-helper-textarea')).toBeFocused()
      await secondPage.keyboard.type(`echo ${secondToken}`)
      await secondPage.keyboard.press('Enter')

      await expect(secondTerminal).toContainText(secondToken)
      await expect(terminal).toContainText(secondToken)
    } finally {
      await secondContext.close()
    }
  })

  test('launches agent sessions from the context menu and streams output', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('agent-launch')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [],
        settings: {
          defaultProvider: 'codex',
          customModelEnabledByProvider: {
            'claude-code': false,
            codex: true,
          },
          customModelByProvider: {
            'claude-code': '',
            codex: 'gpt-5.2-codex',
          },
          customModelOptionsByProvider: {
            'claude-code': [],
            codex: ['gpt-5.2-codex'],
          },
        },
      }),
    )

    await openAuthedCanvas(page)

    const pane = page.locator('.workspace-canvas .react-flow__pane')
    await expect(pane).toBeVisible()
    await pane.click({ button: 'right', position: { x: 320, y: 220 } })

    const runButton = page.locator('[data-testid="workspace-context-run-default-agent"]')
    await expect(runButton).toBeVisible()
    await runButton.click()

    const terminal = page.locator('.terminal-node').first()
    await expect(terminal).toBeVisible()
    await expect(terminal.locator('.xterm')).toBeVisible()
    await expect(terminal).toContainText('[opencove-test-agent] codex new')
    await expect(terminal).toContainText('gpt-5.2-codex')
  })
})
