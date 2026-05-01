#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- profiling script intentionally samples the real app over time */

import { _electron as electron } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifactRoot = path.join(repoPath, 'artifacts', 'agent-restore-startup-profile')
const agentCount = Math.max(
  1,
  Number.parseInt(process.env.OPENCOVE_PROFILE_AGENT_COUNT ?? '12', 10),
)
const provider = resolveProvider(process.env.OPENCOVE_PROFILE_PROVIDER)
const keepUserData = process.env.OPENCOVE_PROFILE_KEEP_USER_DATA === '1'
const startedAtAgeMs = Math.max(
  0,
  Number.parseInt(process.env.OPENCOVE_PROFILE_STARTED_AT_AGE_MS ?? '300000', 10),
)
const visibleOutputTimeoutMs = Math.max(
  10_000,
  Number.parseInt(process.env.OPENCOVE_PROFILE_VISIBLE_TIMEOUT_MS ?? '120000', 10),
)

function resolveProvider(value) {
  return value === 'opencode' || value === 'gemini' || value === 'claude-code' || value === 'codex'
    ? value
    : 'codex'
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function createUserDataDir() {
  return await mkdtemp(path.join(tmpdir(), 'opencove-agent-restore-profile-'))
}

function createAgent(index, startedAt) {
  const column = index % 4
  const row = Math.floor(index / 4)
  const nodeId = `profile-agent-${String(index + 1).padStart(2, '0')}`
  const title = `${provider} restore ${index + 1}`
  const agent = {
    provider,
    prompt: '',
    model: provider === 'codex' ? 'gpt-5.4' : null,
    effectiveModel: provider === 'codex' ? 'gpt-5.4' : null,
    launchMode: 'new',
    resumeSessionId: null,
    resumeSessionIdVerified: false,
    executionDirectory: repoPath,
    expectedDirectory: repoPath,
    directoryMode: 'workspace',
    customDirectory: null,
    shouldCreateDirectory: false,
    taskId: null,
  }

  return {
    nodeId,
    title,
    x: 120 + column * 420,
    y: 120 + row * 320,
    width: 520,
    height: 720,
    startedAt,
    agent,
  }
}

async function seedProfileState(userDataDir) {
  const db = new Database(path.join(userDataDir, 'opencove.db'))
  const startedAt = new Date(Date.now() - startedAtAgeMs).toISOString()
  const agents = Array.from({ length: agentCount }, (_, index) => createAgent(index, startedAt))

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
        environment_variables_json TEXT NOT NULL DEFAULT '{}',
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
        profile_id TEXT,
        runtime_kind TEXT,
        terminal_geometry_json TEXT,
        terminal_provider_hint TEXT,
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
        target_mount_id TEXT,
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

    const settings = {
      language: 'en',
      uiTheme: 'dark',
      defaultProvider: provider,
      agentProviderOrder: ['claude-code', 'codex', 'opencode', 'gemini'],
      agentFullAccess: true,
      defaultTerminalProfileId: null,
      customModelEnabledByProvider: { 'claude-code': false, codex: provider === 'codex' },
      customModelByProvider: { 'claude-code': '', codex: provider === 'codex' ? 'gpt-5.4' : '' },
      customModelOptionsByProvider: {
        'claude-code': [],
        codex: provider === 'codex' ? ['gpt-5.4'] : [],
      },
      focusNodeOnClick: true,
      disableAppShortcutsWhenTerminalFocused: true,
      defaultTerminalWindowScalePercent: 80,
      terminalFontSize: 13,
      terminalFontFamily: null,
      standardWindowSizeBucket: 'regular',
    }

    const insertMeta = db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)')
    insertMeta.run('format_version', '1')
    insertMeta.run('active_workspace_id', 'workspace-profile')
    insertMeta.run('app_state_revision', '1')
    db.prepare('INSERT INTO app_settings (id, value) VALUES (1, ?)').run(JSON.stringify(settings))
    db.prepare(
      `
      INSERT INTO workspaces (
        id, name, path, worktrees_root, pull_request_base_branch_options_json,
        environment_variables_json, space_archive_records_json, viewport_x, viewport_y,
        viewport_zoom, is_minimap_visible, active_space_id, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      'workspace-profile',
      'restore profile',
      repoPath,
      '',
      '[]',
      '{}',
      '[]',
      0,
      0,
      0.75,
      1,
      null,
      0,
    )

    const insertNode = db.prepare(
      `
      INSERT INTO nodes (
        id, workspace_id, session_id, title, title_pinned_by_user,
        position_x, position_y, width, height, kind, profile_id, runtime_kind,
        terminal_geometry_json, terminal_provider_hint, label_color_override, status,
        started_at, ended_at, exit_code, last_error, execution_directory, expected_directory,
        agent_json, task_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )

    for (const agent of agents) {
      insertNode.run(
        agent.nodeId,
        'workspace-profile',
        '',
        agent.title,
        0,
        agent.x,
        agent.y,
        agent.width,
        agent.height,
        'agent',
        null,
        'posix',
        JSON.stringify({ cols: 64, rows: 44 }),
        provider,
        null,
        'standby',
        agent.startedAt,
        null,
        null,
        null,
        repoPath,
        repoPath,
        JSON.stringify(agent.agent),
        null,
      )
    }

    await writeFile(
      path.join(userDataDir, 'approved-workspaces.json'),
      `${JSON.stringify({ version: 1, roots: [repoPath] })}\n`,
      'utf8',
    )
  } finally {
    db.close()
  }
}

async function launchProfiledApp(userDataDir, logSink) {
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
      OPENCOVE_TERMINAL_TEST_API: '1',
    },
  })

  const child = electronApp.process()
  child.stdout?.on('data', chunk => {
    const text = chunk.toString()
    logSink.push(...text.split('\n').filter(Boolean))
    process.stdout.write(text)
  })
  child.stderr?.on('data', chunk => {
    const text = chunk.toString()
    logSink.push(...text.split('\n').filter(Boolean))
    process.stderr.write(text)
  })

  const window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { electronApp, window }
}

async function readRestoreSample(window) {
  return await window.evaluate(() => {
    const api = window.__opencoveTerminalSelectionTestApi
    const nodeElements = [...document.querySelectorAll('.react-flow__node-terminalNode')]
    const registeredNodeIds =
      typeof api?.getRegisteredNodeIds === 'function' ? api.getRegisteredNodeIds() : []
    const runtimeSessionIds = registeredNodeIds
      .map(nodeId =>
        typeof api?.getRuntimeSessionId === 'function' ? api.getRuntimeSessionId(nodeId) : null,
      )
      .filter(sessionId => typeof sessionId === 'string' && sessionId.length > 0)
    const visibleNodeIds = nodeElements.filter(node => {
      if (!(node instanceof HTMLElement)) {
        return false
      }
      const nodeId = node.getAttribute('data-id') ?? node.id.replace(/^react-flow__node-/u, '')
      const transcript =
        typeof window.__OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__ === 'function'
          ? window.__OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__(nodeId)
          : (node.querySelector('.terminal-node__transcript')?.textContent ?? '')
      return transcript.trim().length > 0
    })

    return {
      domTerminalCount: nodeElements.length,
      registeredCount: registeredNodeIds.length,
      runtimeSessionCount: runtimeSessionIds.length,
      visibleOutputCount: visibleNodeIds.length,
      bodyTextLength: document.body.textContent?.length ?? 0,
    }
  })
}

async function waitForSample(window, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    latest = await readRestoreSample(window)
    if (predicate(latest)) {
      return latest
    }
    await delay(100)
  }

  throw new Error(`[profile] timed out waiting for ${label}: ${JSON.stringify(latest)}`)
}

async function main() {
  await ensureDir(artifactRoot)
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${provider}-${agentCount}`
  const artifactDir = path.join(artifactRoot, runId)
  await ensureDir(artifactDir)

  const startedAt = Date.now()
  const marks = []
  const mark = (label, details = null) => {
    const now = Date.now()
    const entry = { label, elapsedMs: now - startedAt, ...(details ? { details } : {}) }
    marks.push(entry)
    process.stdout.write(
      `[profile] ${label}: +${entry.elapsedMs}ms${details ? ` ${JSON.stringify(details)}` : ''}\n`,
    )
  }

  const userDataDir = await createUserDataDir()
  const logs = []
  let electronApp = null

  try {
    mark('seed-start', { userDataDir, agentCount, provider, startedAtAgeMs })
    await seedProfileState(userDataDir)
    mark('seed-complete')

    const launched = await launchProfiledApp(userDataDir, logs)
    electronApp = launched.electronApp
    const window = launched.window
    mark('domcontentloaded')

    await window
      .locator('.workspace-canvas .react-flow__pane')
      .waitFor({ state: 'visible', timeout: 30_000 })
    mark('workspace-pane-visible', await readRestoreSample(window))

    const mounted = await waitForSample(
      window,
      sample => sample.domTerminalCount >= agentCount,
      120_000,
      'all terminal nodes mounted',
    )
    mark('all-terminal-nodes-mounted', mounted)

    const bound = await waitForSample(
      window,
      sample => sample.runtimeSessionCount >= agentCount,
      120_000,
      'all runtime session bindings',
    )
    mark('all-runtime-sessions-bound', bound)

    const visible = await waitForSample(
      window,
      sample => sample.visibleOutputCount >= agentCount,
      visibleOutputTimeoutMs,
      'all terminal outputs visible',
    )
    mark('all-terminal-outputs-visible', visible)

    await window.screenshot({ path: path.join(artifactDir, 'restored-agents.png') })
  } finally {
    await writeFile(
      path.join(artifactDir, 'marks.json'),
      `${JSON.stringify(marks, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      path.join(artifactDir, 'terminal-diagnostics.log'),
      `${logs.join('\n')}\n`,
      'utf8',
    )
    process.stdout.write(`[profile] artifacts: ${artifactDir}\n`)
    await electronApp?.close().catch(() => undefined)
    if (!keepUserData) {
      await rm(userDataDir, { recursive: true, force: true })
    }
  }
}

await main()
