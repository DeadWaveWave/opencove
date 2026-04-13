#!/usr/bin/env node

import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const repoPath = path.resolve(new URL('..', import.meta.url).pathname)

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function createUserDataDir() {
  return await mkdtemp(path.join(tmpdir(), 'opencove-real-repro-'))
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
      OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS: '1',
    },
  })

  await attachElectronLogs(electronApp, logSink)
  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { electronApp, window }
}

async function seedWorkspaceStateOnDisk(userDataDir) {
  const dbPath = path.join(userDataDir, 'opencove.db')
  const db = new Database(dbPath)

  const settings = {
    language: 'en',
    uiTheme: 'dark',
    isPrimarySidebarCollapsed: false,
    workspaceSearchPanelWidth: 420,
    defaultProvider: 'codex',
    agentProviderOrder: ['claude-code', 'codex', 'opencode', 'gemini'],
    agentFullAccess: true,
    defaultTerminalProfileId: null,
    customModelEnabledByProvider: {
      'claude-code': false,
      codex: true,
      opencode: false,
      gemini: false,
    },
    customModelByProvider: {
      'claude-code': '',
      codex: 'gpt-5.4',
      opencode: '',
      gemini: '',
    },
    customModelOptionsByProvider: {
      'claude-code': [],
      codex: ['gpt-5.4'],
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

async function inspectRestoredAgent(window) {
  const agentNode = window.locator('.terminal-node').first()
  await agentNode.waitFor({ state: 'visible', timeout: 60_000 })
  await agentNode.locator('.xterm').waitFor({ state: 'visible', timeout: 30_000 })
  const helper = agentNode.locator('.xterm-helper-textarea')

  const initialMainPid = await window.evaluate(() => window.opencoveApi.meta.mainPid)
  process.stdout.write(`[repro] preload mainPid: ${String(initialMainPid)}\n`)

  await agentNode.locator('.xterm').click()
  await helper.waitFor({ state: 'attached', timeout: 10_000 })
  await delay(300)

  const focusImmediately = await helper.evaluate(node => node === document.activeElement)
  process.stdout.write(`[repro] helper focused immediately: ${String(focusImmediately)}\n`)

  await delay(2_000)
  const focusAfterDelay = await helper.evaluate(node => node === document.activeElement)
  process.stdout.write(`[repro] helper focused after 2s: ${String(focusAfterDelay)}\n`)

  process.stdout.write('[repro] waiting for restored session to replace placeholder...\n')
  await delay(3_500)

  await agentNode.locator('.xterm').click()
  await delay(300)
  const focusAfterRestoreClick = await helper.evaluate(node => node === document.activeElement)
  process.stdout.write(
    `[repro] helper focused after restored-session click: ${String(focusAfterRestoreClick)}\n`,
  )

  await window.keyboard.type('1')
  await delay(500)
  await window.keyboard.press('Enter')
  await delay(2_000)

  const focusAfterTyping = await helper.evaluate(node => node === document.activeElement)
  process.stdout.write(`[repro] helper focused after typing: ${String(focusAfterTyping)}\n`)

  const terminalText = await agentNode.textContent()
  process.stdout.write(`[repro] agent node text snapshot:\n${terminalText ?? ''}\n`)
}

async function main() {
  const userDataDir = await createUserDataDir()
  const logs = []

  process.stdout.write(`[repro] userDataDir=${userDataDir}\n`)

  try {
    await seedWorkspaceStateOnDisk(userDataDir)

    const second = await launchApp({ userDataDir, logSink: logs })
    try {
      await createAgent(second.window)
      await delay(8_000)
    } finally {
      await second.electronApp.close()
    }

    await delay(1_000)

    const third = await launchApp({ userDataDir, logSink: logs })
    try {
      await inspectRestoredAgent(third.window)
    } finally {
      await third.electronApp.close()
    }
  } finally {
    const diagnosticTail = logs
      .filter(
        line =>
          line.includes('opencove-terminal-diagnostics') || line.includes('opencove-pty-write'),
      )
      .slice(-80)
      .join('\n')
    process.stdout.write(`\n[repro] diagnostic tail:\n${diagnosticTail}\n`)
    await rm(userDataDir, { recursive: true, force: true })
  }
}

await main()
