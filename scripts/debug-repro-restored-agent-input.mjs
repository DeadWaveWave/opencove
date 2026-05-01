#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- debug repro intentionally uses bounded polling and sequential restart steps */

import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const screenshotRoot = path.join(repoPath, 'artifacts', 'debug-restored-agent-input')
const provider = process.env.OPENCOVE_REPRO_PROVIDER === 'opencode' ? 'opencode' : 'codex'
const iterationCount = Math.max(
  1,
  Number.parseInt(process.env.OPENCOVE_REPRO_ITERATIONS ?? '1', 10),
)
const closeMode = process.env.OPENCOVE_REPRO_CLOSE_MODE === 'cmd-w' ? 'cmd-w' : 'cold-restart'

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function resolveLastNonEmptyLine(value) {
  return (
    value
      .split('\n')
      .map(line => line.trimEnd())
      .reverse()
      .find(line => line.trim().length > 0) ?? ''
  )
}

function resolveLastMatchingLine(value, pattern) {
  return (
    value
      .split('\n')
      .map(line => line.trimEnd())
      .reverse()
      .find(line => pattern.test(line)) ?? ''
  )
}

function resolveVisibleTerminalLine(snapshot) {
  const candidates = [
    resolveLastNonEmptyLine(snapshot.debugTranscriptText),
    resolveLastNonEmptyLine(snapshot.transcriptText),
  ]

  return candidates.find(line => line.length > 0) ?? ''
}

function resolveCodexPromptLine(snapshot) {
  const candidates = [
    resolveLastMatchingLine(snapshot.debugTranscriptText, /^\s*›/u),
    resolveLastMatchingLine(snapshot.transcriptText, /^\s*›/u),
  ]

  return candidates.find(line => line.length > 0) ?? ''
}

async function createUserDataDir() {
  return await mkdtemp(path.join(tmpdir(), 'opencove-real-repro-'))
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function captureWindowScreenshot(window, dirPath, label) {
  await ensureDir(dirPath)
  const screenshotPath = path.join(dirPath, `${label}.png`)
  await window.screenshot({ path: screenshotPath })
  process.stdout.write(`[repro] screenshot saved: ${screenshotPath}\n`)
  return screenshotPath
}

async function resolveSingleAgentBinding(window) {
  const raw = await window.evaluate(async () => {
    return await window.opencoveApi.persistence.readWorkspaceStateRaw()
  })

  if (!raw) {
    return { nodeId: null, sessionId: null }
  }

  const parsed = JSON.parse(raw)
  const agent = parsed?.workspaces?.[0]?.nodes?.find(node => node?.kind === 'agent')

  return {
    nodeId: typeof agent?.id === 'string' && agent.id.length > 0 ? agent.id : null,
    sessionId:
      typeof agent?.sessionId === 'string' && agent.sessionId.trim().length > 0
        ? agent.sessionId
        : null,
  }
}

async function resolveRuntimeAgentBinding(window) {
  const persisted = await resolveSingleAgentBinding(window)

  return await window.evaluate(binding => {
    const api = window.__opencoveTerminalSelectionTestApi
    const registeredNodeIds =
      typeof api?.getRegisteredNodeIds === 'function' ? api.getRegisteredNodeIds() : []
    const domNode = document.querySelector('.react-flow__node-terminalNode')
    const domNodeId =
      domNode instanceof HTMLElement
        ? (domNode.getAttribute('data-id') ?? domNode.id.replace(/^react-flow__node-/u, '').trim())
        : null
    const nodeId =
      binding.nodeId ??
      (registeredNodeIds.length === 1 ? (registeredNodeIds[0] ?? null) : null) ??
      (domNodeId && domNodeId.length > 0 ? domNodeId : null)
    const runtimeSessionId =
      nodeId && typeof api?.getRuntimeSessionId === 'function'
        ? api.getRuntimeSessionId(nodeId)
        : null

    return {
      nodeId,
      sessionId: binding.sessionId ?? runtimeSessionId,
      persistedSessionId: binding.sessionId,
      runtimeSessionId,
      registeredNodeIds,
    }
  }, persisted)
}

async function waitForRuntimeAgentBinding(window, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let latestBinding = null

  while (Date.now() < deadline) {
    latestBinding = await resolveRuntimeAgentBinding(window)
    if (latestBinding.nodeId && latestBinding.sessionId) {
      return latestBinding
    }

    await delay(100)
  }

  throw new Error(
    `[repro] restored agent runtime binding was not ready: ${JSON.stringify(latestBinding)}`,
  )
}

function hasConvergedTerminalGeometry(geometry) {
  if (!geometry?.terminalSize || !geometry.snapshotSize) {
    return false
  }

  if (
    geometry.terminalSize.cols !== geometry.snapshotSize.cols ||
    geometry.terminalSize.rows !== geometry.snapshotSize.rows
  ) {
    return false
  }

  if (
    geometry.horizontalGapPx === null ||
    geometry.verticalGapPx === null ||
    geometry.cellWidthPx === null ||
    geometry.cellHeightPx === null
  ) {
    return false
  }

  return (
    geometry.horizontalGapPx >= -2 &&
    geometry.verticalGapPx >= -2 &&
    geometry.horizontalGapPx <= Math.max(48, geometry.cellWidthPx * 6) &&
    geometry.verticalGapPx <= Math.max(48, geometry.cellHeightPx * 4)
  )
}

async function readRestoredTerminalGeometry(window, nodeId, sessionId) {
  return await window.evaluate(
    async payload => {
      const terminalSize =
        window.__opencoveTerminalSelectionTestApi?.getSize(payload.nodeId) ?? null
      const metrics =
        window.__opencoveTerminalSelectionTestApi?.getRenderMetrics?.(payload.nodeId) ?? null
      const snapshot =
        typeof window.opencoveApi.pty.presentationSnapshot === 'function'
          ? await window.opencoveApi.pty
              .presentationSnapshot({ sessionId: payload.sessionId })
              .catch(() => null)
          : null
      const container = document.querySelector('.terminal-node__terminal')
      if (!(container instanceof HTMLElement)) {
        return null
      }

      const screen =
        container.querySelector('.xterm-screen canvas') ?? container.querySelector('.xterm-screen')
      const screenRect = screen instanceof HTMLElement ? screen.getBoundingClientRect() : null
      const contentWidth =
        terminalSize && metrics?.cssCellWidth && metrics.cssCellWidth > 0
          ? terminalSize.cols * metrics.cssCellWidth
          : metrics?.cssCanvasWidth && metrics.cssCanvasWidth > 0
            ? metrics.cssCanvasWidth
            : (screenRect?.width ?? null)
      const contentHeight =
        terminalSize && metrics?.cssCellHeight && metrics.cssCellHeight > 0
          ? terminalSize.rows * metrics.cssCellHeight
          : metrics?.cssCanvasHeight && metrics.cssCanvasHeight > 0
            ? metrics.cssCanvasHeight
            : (screenRect?.height ?? null)
      const cellWidthPx =
        metrics?.cssCellWidth && metrics.cssCellWidth > 0
          ? metrics.cssCellWidth
          : terminalSize && contentWidth
            ? contentWidth / Math.max(1, terminalSize.cols)
            : null
      const cellHeightPx =
        metrics?.cssCellHeight && metrics.cssCellHeight > 0
          ? metrics.cssCellHeight
          : terminalSize && contentHeight
            ? contentHeight / Math.max(1, terminalSize.rows)
            : null

      return {
        terminalSize,
        snapshotSize: snapshot ? { cols: snapshot.cols, rows: snapshot.rows } : null,
        horizontalGapPx: contentWidth === null ? null : container.clientWidth - contentWidth,
        verticalGapPx: contentHeight === null ? null : container.clientHeight - contentHeight,
        cellWidthPx,
        cellHeightPx,
      }
    },
    { nodeId, sessionId },
  )
}

async function readAgentSnapshot(agentNode, helper, nodeId, sessionId) {
  const snapshot = await agentNode.evaluate(node => {
    const transcript = node.querySelector('.terminal-node__transcript')
    const xterm = node.querySelector('.xterm')
    const recovering = node.querySelector('.terminal-node__recovering')
    return {
      textContent: node.textContent ?? '',
      transcriptText: transcript?.textContent ?? '',
      xtermClassName: xterm?.className ?? '',
      recoveringText: recovering?.textContent ?? '',
    }
  })
  const helperFocused = await helper.evaluate(node => node === document.activeElement)
  const debugTranscriptText = await agentNode.page().evaluate(currentNodeId => {
    const reader = window.__OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__
    if (
      typeof reader !== 'function' ||
      typeof currentNodeId !== 'string' ||
      currentNodeId.length === 0
    ) {
      return ''
    }

    return reader(currentNodeId)
  }, nodeId)
  const geometry =
    nodeId && sessionId
      ? await readRestoredTerminalGeometry(agentNode.page(), nodeId, sessionId)
      : null
  return {
    ...snapshot,
    geometry,
    geometryConverged: hasConvergedTerminalGeometry(geometry),
    helperFocused,
    debugTranscriptText,
    lastTranscriptLine: resolveLastNonEmptyLine(snapshot.transcriptText),
    lastDebugTranscriptLine: resolveLastNonEmptyLine(debugTranscriptText),
    lastVisibleLine: resolveVisibleTerminalLine({
      transcriptText: snapshot.transcriptText,
      debugTranscriptText,
    }),
    lastCodexPromptLine: resolveCodexPromptLine({
      transcriptText: snapshot.transcriptText,
      debugTranscriptText,
    }),
  }
}

async function assertAgentStep({
  agentNode,
  helper,
  nodeId,
  sessionId,
  dirPath,
  label,
  requireFocus = false,
  requiredText = null,
  forbiddenText = null,
  requiredVisibleLineText = null,
  forbiddenVisibleLineText = null,
  requiredPromptLineText = null,
  forbiddenPromptLineText = null,
}) {
  const snapshot = await readAgentSnapshot(agentNode, helper, nodeId, sessionId)
  await writeFile(
    path.join(dirPath, `${label}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  )

  if (snapshot.textContent.trim().length === 0) {
    throw new Error(`[repro] ${label}: agent node text became blank`)
  }

  const hasVisibleTerminalOutput = snapshot.lastVisibleLine.trim().length > 0
  const hasRecoveringState = snapshot.recoveringText.trim().length > 0
  if (!hasVisibleTerminalOutput && !hasRecoveringState) {
    throw new Error(`[repro] ${label}: restored agent has neither visible output nor recovering UI`)
  }

  if (
    (label.includes('after-type') || label.includes('after-backspace')) &&
    !hasVisibleTerminalOutput
  ) {
    throw new Error(`[repro] ${label}: restored agent did not render visible output after input`)
  }

  if (
    (label.includes('after-handoff') ||
      label.includes('after-type') ||
      label.includes('after-backspace')) &&
    hasVisibleTerminalOutput &&
    !hasRecoveringState &&
    !snapshot.geometryConverged
  ) {
    throw new Error(
      `[repro] ${label}: terminal geometry did not converge: ${JSON.stringify(snapshot.geometry)}`,
    )
  }

  if (snapshot.transcriptText.length > 0 && snapshot.transcriptText.trim().length === 0) {
    throw new Error(`[repro] ${label}: transcript mirror became blank-only text`)
  }

  if (snapshot.debugTranscriptText.length > 0 && snapshot.debugTranscriptText.trim().length === 0) {
    throw new Error(`[repro] ${label}: debug transcript mirror became blank-only text`)
  }

  if (requireFocus && !snapshot.helperFocused) {
    throw new Error(`[repro] ${label}: helper textarea lost focus`)
  }

  if (
    requiredText &&
    !snapshot.textContent.includes(requiredText) &&
    !snapshot.transcriptText.includes(requiredText) &&
    !snapshot.debugTranscriptText.includes(requiredText)
  ) {
    throw new Error(`[repro] ${label}: expected text not found: ${requiredText}`)
  }

  if (requiredVisibleLineText && !snapshot.lastVisibleLine.includes(requiredVisibleLineText)) {
    throw new Error(
      `[repro] ${label}: expected visible line text not found: ${requiredVisibleLineText}; line=${snapshot.lastVisibleLine}`,
    )
  }

  if (
    forbiddenText &&
    (snapshot.textContent.includes(forbiddenText) ||
      snapshot.transcriptText.includes(forbiddenText) ||
      snapshot.debugTranscriptText.includes(forbiddenText))
  ) {
    throw new Error(`[repro] ${label}: unexpected text remained visible: ${forbiddenText}`)
  }

  if (forbiddenVisibleLineText && snapshot.lastVisibleLine.includes(forbiddenVisibleLineText)) {
    throw new Error(
      `[repro] ${label}: unexpected visible line text remained: ${forbiddenVisibleLineText}; line=${snapshot.lastVisibleLine}`,
    )
  }

  if (requiredPromptLineText && !snapshot.lastCodexPromptLine.includes(requiredPromptLineText)) {
    throw new Error(
      `[repro] ${label}: expected prompt line text not found: ${requiredPromptLineText}; line=${snapshot.lastCodexPromptLine}`,
    )
  }

  if (forbiddenPromptLineText && snapshot.lastCodexPromptLine.includes(forbiddenPromptLineText)) {
    throw new Error(
      `[repro] ${label}: unexpected prompt line text remained: ${forbiddenPromptLineText}; line=${snapshot.lastCodexPromptLine}`,
    )
  }
}

async function attachElectronLogs(electronApp, sink) {
  const child = electronApp.process()
  child.stdout?.on('data', chunk => {
    const text = chunk.toString()
    sink.push(...text.split('\n').filter(Boolean))
    process.stdout.write(text)
  })
  child.stderr?.on('data', chunk => {
    const text = chunk.toString()
    sink.push(...text.split('\n').filter(Boolean))
    process.stderr.write(text)
  })
}

async function launchApp({ userDataDir, logSink }) {
  const env = { ...process.env }
  delete env.__CFBundleIdentifier
  delete env.ELECTRON_RUN_AS_NODE

  const electronApp = await electron.launch({
    args: [repoPath],
    env: {
      ...env,
      NODE_ENV: 'development',
      OPENCOVE_DEV_USER_DATA_DIR: userDataDir,
      OPENCOVE_TERMINAL_DIAGNOSTICS: '1',
      OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS: '1',
      OPENCOVE_TERMINAL_TEST_API: '1',
    },
  })

  await attachElectronLogs(electronApp, logSink)
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { electronApp, window }
}

async function waitForBrowserWindowCount(electronApp, expectedCount, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const count = await electronApp.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).length
    })

    if (count === expectedCount) {
      return
    }

    await delay(100)
  }

  throw new Error(
    `[repro] Timed out waiting for BrowserWindow count ${expectedCount} during ${closeMode}`,
  )
}

async function waitForBrowserWindowCountOrFalse(electronApp, expectedCount, timeoutMs) {
  try {
    await waitForBrowserWindowCount(electronApp, expectedCount, timeoutMs)
    return true
  } catch {
    return false
  }
}

async function waitForNewWindow(electronApp, previousWindows, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const nextWindow =
      electronApp
        .windows()
        .find(window => !window.isClosed() && !previousWindows.includes(window)) ?? null

    if (nextWindow) {
      await nextWindow.waitForLoadState('domcontentloaded')
      return nextWindow
    }

    await delay(100)
  }

  throw new Error(`[repro] Timed out waiting for a reopened window during ${closeMode}`)
}

async function closeWindowAndReopenApp({ electronApp, window: mainWindowPage }) {
  const previousWindows = electronApp.windows().filter(page => !page.isClosed())
  const closeShortcut = process.platform === 'darwin' ? 'Meta+W' : 'Control+W'
  const closeShortcutPayload =
    process.platform === 'darwin'
      ? { keyCode: 'W', modifiers: ['meta'] }
      : { keyCode: 'W', modifiers: ['control'] }

  await mainWindowPage.bringToFront().catch(() => undefined)
  await mainWindowPage
    .locator('body')
    .click({ position: { x: 40, y: 40 } })
    .catch(() => undefined)
  await mainWindowPage.keyboard.press(closeShortcut).catch(() => undefined)

  let didCloseWindow = await waitForBrowserWindowCountOrFalse(electronApp, 0, 1_500)
  if (!didCloseWindow) {
    const dispatchedCloseAction =
      process.platform === 'darwin'
        ? await electronApp
            .evaluate(({ BrowserWindow, Menu }) => {
              const browserWindow = BrowserWindow.getAllWindows().find(
                candidate => !candidate.isDestroyed(),
              )
              if (!browserWindow || typeof Menu.sendActionToFirstResponder !== 'function') {
                return false
              }

              browserWindow.focus()
              browserWindow.webContents.focus()
              Menu.sendActionToFirstResponder('performClose:')
              return true
            })
            .catch(() => false)
        : false

    if (dispatchedCloseAction) {
      didCloseWindow = await waitForBrowserWindowCountOrFalse(electronApp, 0, 1_500)
    }
  }

  if (!didCloseWindow) {
    const dispatchedShortcut = await electronApp
      .evaluate(({ BrowserWindow }, payload) => {
        const browserWindow = BrowserWindow.getAllWindows().find(
          candidate => !candidate.isDestroyed(),
        )
        if (!browserWindow) {
          return false
        }

        browserWindow.focus()
        browserWindow.webContents.focus()
        browserWindow.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: payload.keyCode,
          modifiers: payload.modifiers,
        })
        browserWindow.webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: payload.keyCode,
          modifiers: payload.modifiers,
        })
        return true
      }, closeShortcutPayload)
      .catch(() => false)

    if (dispatchedShortcut) {
      didCloseWindow = await waitForBrowserWindowCountOrFalse(electronApp, 0, 1_500)
    }
  }

  if (!didCloseWindow) {
    process.stdout.write(
      '[repro] close shortcut did not close the window; falling back to BrowserWindow.close().\n',
    )
    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows().find(
        candidate => !candidate.isDestroyed(),
      )
      browserWindow?.close()
      return Boolean(browserWindow)
    })
    await waitForBrowserWindowCount(electronApp, 0)
  }

  await electronApp.evaluate(({ app }) => {
    app.emit('activate')
  })

  await waitForBrowserWindowCount(electronApp, 1)
  return await waitForNewWindow(electronApp, previousWindows)
}

async function seedWorkspaceStateOnDisk(userDataDir) {
  const dbPath = path.join(userDataDir, 'opencove.db')
  const db = new Database(dbPath)

  const settings = {
    language: 'en',
    uiTheme: 'dark',
    isPrimarySidebarCollapsed: false,
    workspaceSearchPanelWidth: 420,
    defaultProvider: provider,
    agentProviderOrder: ['claude-code', 'codex', 'opencode', 'gemini'],
    agentFullAccess: true,
    defaultTerminalProfileId: null,
    customModelEnabledByProvider: {
      'claude-code': false,
      codex: provider === 'codex',
      opencode: false,
      gemini: false,
    },
    customModelByProvider: {
      'claude-code': '',
      codex: provider === 'codex' ? 'gpt-5.4' : '',
      opencode: '',
      gemini: '',
    },
    customModelOptionsByProvider: {
      'claude-code': [],
      codex: provider === 'codex' ? ['gpt-5.4'] : [],
      opencode: [],
      gemini: [],
    },
    taskTitleProvider: 'default',
    taskTitleModel: '',
    taskTagOptions: ['feature', 'bug', 'refactor', 'docs', 'test'],
    taskPromptTemplates: [],
    taskPromptTemplatesByWorkspaceId: {},
    focusNodeOnClick: true,
    focusNodeTargetZoom: 1,
    standbyBannerEnabled: true,
    standbyBannerShowTask: true,
    standbyBannerShowSpace: true,
    standbyBannerShowBranch: true,
    standbyBannerShowPullRequest: true,
    disableAppShortcutsWhenTerminalFocused: true,
    keybindings: {},
    canvasInputMode: 'auto',
    canvasWheelBehavior: 'zoom',
    canvasWheelZoomModifier: 'primary',
    standardWindowSizeBucket: 'regular',
    websiteWindowPolicy: {
      enabled: false,
      maxActiveCount: 1,
      discardAfterMinutes: 20,
      keepAliveHosts: [],
    },
    experimentalWebsiteWindowPasteEnabled: false,
    defaultTerminalWindowScalePercent: 80,
    terminalFontSize: 13,
    terminalFontFamily: null,
    uiFontSize: 18,
    githubPullRequestsEnabled: true,
    updatePolicy: 'prompt',
    updateChannel: 'stable',
    releaseNotesSeenVersion: null,
    hideWorktreeMismatchDropWarning: false,
  }

  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        worktrees_root TEXT NOT NULL,
        pull_request_base_branch_options_json TEXT NOT NULL DEFAULT '[]',
        space_archive_records_json TEXT NOT NULL DEFAULT '[]',
        viewport_x REAL NOT NULL,
        viewport_y REAL NOT NULL,
        viewport_zoom REAL NOT NULL,
        is_minimap_visible INTEGER NOT NULL,
        active_space_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT,
        title TEXT NOT NULL,
        title_pinned_by_user INTEGER NOT NULL,
        position_x REAL NOT NULL,
        position_y REAL NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        kind TEXT NOT NULL,
        label_color_override TEXT,
        status TEXT,
        started_at TEXT,
        ended_at TEXT,
        exit_code INTEGER,
        last_error TEXT,
        execution_directory TEXT,
        expected_directory TEXT,
        agent_json TEXT,
        task_json TEXT
      );

      CREATE TABLE IF NOT EXISTS workspace_spaces (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        directory_path TEXT NOT NULL,
        label_color TEXT,
        rect_x REAL,
        rect_y REAL,
        rect_width REAL,
        rect_height REAL
      );

      CREATE TABLE IF NOT EXISTS workspace_space_nodes (
        space_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (space_id, node_id)
      );

      CREATE TABLE IF NOT EXISTS node_scrollback (
        node_id TEXT PRIMARY KEY,
        scrollback TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_node_placeholder_scrollback (
        node_id TEXT PRIMARY KEY,
        scrollback TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)

    db.exec(`
      DELETE FROM workspace_space_nodes;
      DELETE FROM workspace_spaces;
      DELETE FROM node_scrollback;
      DELETE FROM agent_node_placeholder_scrollback;
      DELETE FROM nodes;
      DELETE FROM workspaces;
      DELETE FROM app_meta;
      DELETE FROM app_settings;
    `)

    const upsertMeta = db.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    upsertMeta.run('format_version', '1')
    upsertMeta.run('active_workspace_id', 'workspace-seeded')
    upsertMeta.run('app_state_revision', '1')

    db.prepare(
      `
      INSERT INTO app_settings (id, value)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value
    `,
    ).run(JSON.stringify(settings))

    db.prepare(
      `
      INSERT INTO workspaces (
        id, name, path, worktrees_root, pull_request_base_branch_options_json, space_archive_records_json,
        viewport_x, viewport_y, viewport_zoom, is_minimap_visible, active_space_id, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      'workspace-seeded',
      path.basename(repoPath),
      repoPath,
      '',
      '[]',
      '[]',
      0,
      0,
      1,
      1,
      null,
      0,
    )

    const approvedSnapshot = {
      version: 1,
      roots: [repoPath],
    }
    const approvedPath = path.join(userDataDir, 'approved-workspaces.json')
    const fs = await import('node:fs/promises')
    await fs.writeFile(approvedPath, `${JSON.stringify(approvedSnapshot)}\n`, 'utf8')
  } finally {
    db.close()
  }
}

async function createAgent(window) {
  const pane = window.locator('.workspace-canvas .react-flow__pane')
  try {
    await pane.waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    const rawState = await window.evaluate(async () => {
      return await window.opencoveApi.persistence.readWorkspaceStateRaw()
    })
    const bodyText = await window.locator('body').textContent()
    throw new Error(
      `Workspace pane not visible. Raw state: ${rawState ?? 'null'}\nBody text: ${bodyText ?? ''}\n${String(error)}`,
      { cause: error },
    )
  }
  await pane.click({ button: 'right', position: { x: 320, y: 220 } })

  const runButton = window.locator('[data-testid="workspace-context-run-default-agent"]')
  await runButton.waitFor({ state: 'visible', timeout: 20_000 })
  await runButton.click()

  const agentNode = window.locator('.terminal-node').first()
  await agentNode.waitFor({ state: 'visible', timeout: 60_000 })
  await agentNode.locator('.xterm').waitFor({ state: 'visible', timeout: 30_000 })
  return agentNode
}

async function waitForRestoredAgentReady({ agentNode, helper, nodeId, sessionId, dirPath }) {
  const deadline = Date.now() + 15_000
  let latestSnapshot = null

  while (Date.now() < deadline) {
    latestSnapshot = await readAgentSnapshot(agentNode, helper, nodeId, sessionId)
    if (
      latestSnapshot.lastVisibleLine.trim().length > 0 &&
      latestSnapshot.recoveringText.trim().length === 0
    ) {
      await captureWindowScreenshot(agentNode.page(), dirPath, 'restored-ready-before-input')
      await writeFile(
        path.join(dirPath, 'restored-ready-before-input.json'),
        `${JSON.stringify(latestSnapshot, null, 2)}\n`,
        'utf8',
      )
      return
    }

    await delay(250)
  }

  if (latestSnapshot) {
    await writeFile(
      path.join(dirPath, 'restored-ready-timeout.json'),
      `${JSON.stringify(latestSnapshot, null, 2)}\n`,
      'utf8',
    )
  }
  await captureWindowScreenshot(agentNode.page(), dirPath, 'restored-ready-timeout')
  throw new Error('[repro] restored agent did not become ready before input')
}

async function inspectRestoredAgent(window, dirPath) {
  const agentNode = window.locator('.terminal-node').first()
  await agentNode.waitFor({ state: 'visible', timeout: 60_000 })
  await agentNode.locator('.xterm').waitFor({ state: 'visible', timeout: 30_000 })
  const helper = agentNode.locator('.xterm-helper-textarea')
  const binding = await waitForRuntimeAgentBinding(window)
  const nodeId = binding.nodeId
  const sessionId = binding.sessionId

  const initialMainPid = await window.evaluate(() => window.opencoveApi.meta.mainPid)
  process.stdout.write(`[repro] preload mainPid: ${String(initialMainPid)}\n`)
  process.stdout.write(`[repro] restored binding: ${JSON.stringify(binding)}\n`)
  await captureWindowScreenshot(window, dirPath, 'restored-before-first-click')
  await assertAgentStep({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
    label: 'restored-before-first-click',
  })

  await agentNode.locator('.xterm').click()
  await helper.waitFor({ state: 'attached', timeout: 10_000 })
  await delay(300)
  await captureWindowScreenshot(window, dirPath, 'restored-after-first-click')

  const focusImmediately = await helper.evaluate(node => node === document.activeElement)
  process.stdout.write(`[repro] helper focused immediately: ${String(focusImmediately)}\n`)
  await assertAgentStep({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
    label: 'restored-after-first-click',
    requireFocus: true,
  })

  await delay(2_000)
  const focusAfterDelay = await helper.evaluate(node => node === document.activeElement)
  process.stdout.write(`[repro] helper focused after 2s: ${String(focusAfterDelay)}\n`)
  await captureWindowScreenshot(window, dirPath, 'restored-after-2s')
  await assertAgentStep({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
    label: 'restored-after-2s',
    requireFocus: true,
  })

  process.stdout.write('[repro] waiting for restored session to replace placeholder...\n')
  await delay(3_500)
  await captureWindowScreenshot(window, dirPath, 'restored-after-handoff-wait')
  await assertAgentStep({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
    label: 'restored-after-handoff-wait',
    requireFocus: true,
  })

  await waitForRestoredAgentReady({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
  })

  await agentNode.locator('.xterm').click()
  await delay(300)
  const focusAfterRestoreClick = await helper.evaluate(node => node === document.activeElement)
  process.stdout.write(
    `[repro] helper focused after restored-session click: ${String(focusAfterRestoreClick)}\n`,
  )
  await captureWindowScreenshot(window, dirPath, 'restored-after-second-click')
  await assertAgentStep({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
    label: 'restored-after-second-click',
    requireFocus: true,
  })

  await window.keyboard.type('12')
  await delay(250)
  await captureWindowScreenshot(window, dirPath, 'restored-after-type-12')
  await assertAgentStep({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
    label: 'restored-after-type-12',
    requireFocus: true,
    requiredPromptLineText: provider === 'codex' ? '12' : null,
  })

  await window.keyboard.press('Backspace')
  await delay(500)
  await captureWindowScreenshot(window, dirPath, 'restored-after-backspace')
  await assertAgentStep({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
    label: 'restored-after-backspace',
    requireFocus: true,
    requiredPromptLineText: provider === 'codex' ? '1' : null,
    forbiddenPromptLineText: provider === 'codex' ? '12' : null,
  })

  await window.keyboard.press('Enter')
  await delay(2_000)
  await captureWindowScreenshot(window, dirPath, 'restored-after-type-and-enter')

  const focusAfterTyping = await helper.evaluate(node => node === document.activeElement)
  process.stdout.write(`[repro] helper focused after typing: ${String(focusAfterTyping)}\n`)
  await assertAgentStep({
    agentNode,
    helper,
    nodeId,
    sessionId,
    dirPath,
    label: 'restored-after-type-and-enter',
    requireFocus: true,
    requiredText: provider === 'codex' ? '1' : null,
  })

  const terminalText = await agentNode.textContent()
  process.stdout.write(`[repro] agent node text snapshot:\n${terminalText ?? ''}\n`)
  await writeFile(path.join(dirPath, 'terminal-text.txt'), `${terminalText ?? ''}\n`, 'utf8')
}

async function main() {
  await ensureDir(screenshotRoot)

  for (let iteration = 1; iteration <= iterationCount; iteration += 1) {
    const userDataDir = await createUserDataDir()
    const logs = []
    const iterationDir = path.join(
      screenshotRoot,
      `${provider}-run-${String(iteration).padStart(2, '0')}`,
    )

    process.stdout.write(
      `[repro] iteration=${iteration}/${iterationCount} provider=${provider} closeMode=${closeMode} userDataDir=${userDataDir}\n`,
    )

    try {
      await seedWorkspaceStateOnDisk(userDataDir)

      const first = await launchApp({ userDataDir, logSink: logs })
      try {
        await createAgent(first.window)
        await delay(8_000)

        if (closeMode === 'cmd-w') {
          const reopenedWindow = await closeWindowAndReopenApp(first)
          await inspectRestoredAgent(reopenedWindow, iterationDir)
        } else {
          await first.electronApp.close()
          await delay(1_000)

          const restarted = await launchApp({ userDataDir, logSink: logs })
          try {
            await inspectRestoredAgent(restarted.window, iterationDir)
          } finally {
            await restarted.electronApp.close()
          }

          continue
        }
      } finally {
        await first.electronApp.close().catch(() => undefined)
      }
    } finally {
      const diagnosticTail = logs
        .filter(
          line =>
            line.includes('opencove-terminal-diagnostics') ||
            line.includes('opencove-pty-write') ||
            line.includes('opencove-pty-resize'),
        )
        .slice(-120)
        .join('\n')
      await writeFile(path.join(iterationDir, 'diagnostic-tail.log'), `${diagnosticTail}\n`, 'utf8')
      process.stdout.write(
        `\n[repro] diagnostic tail saved: ${path.join(iterationDir, 'diagnostic-tail.log')}\n`,
      )
      await rm(userDataDir, { recursive: true, force: true })
    }
  }
}

await main()
