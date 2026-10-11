const e2e = name => `tests/e2e/${name}.spec.ts`

export const QUICK_E2E_GROUPS = {
  core: {
    reason: 'Startup, terminal launch directory, and usable sessions after restart.',
    tests: [
      e2e('smoke'),
      e2e('workspace-canvas.root-terminal-admission'),
      e2e('recovery.worker-client-input-after-restart'),
    ],
  },
  plugins: {
    reason: 'Independent install/reload/restart, Web views, contribution preferences and details.',
    tests: [
      e2e('plugins.local'),
      e2e('plugins.commands'),
      e2e('plugins.titles'),
      e2e('plugins.contributions'),
      e2e('plugins.details'),
      e2e('plugins.host-extensions'),
      e2e('plugins.themes'),
    ],
    matches: path => /plugin/.test(path),
  },
  pluginInteraction: {
    reason: 'Shared plugin pointer changes also cover previews below the viewport and host APIs.',
    tests: [e2e('plugins.canvas'), e2e('plugins.filesystem'), e2e('plugins.targets')],
    matches: path => path === 'tests/e2e/plugins.local.helpers.ts',
  },
  windows: {
    reason: 'Shared window movement, resize and collapse preserve live content.',
    tests: [e2e('workspace-canvas.drag-resize'), e2e('workspace-canvas.collapse-motion')],
    matches: path =>
      /canvasnodewindow|canvas-node-window|nodekindicon|windowcollapse|collapsedwindow|collapse|node-chrome|node-resize|nodeframe|workspacecanvasinner|workspacecanvasview|usenodesstore/.test(
        path,
      ),
  },
  spaces: {
    reason: 'Space geometry and new windows respect compact nodes and neighboring content.',
    tests: [
      e2e('workspace-canvas.child-space-resize-collision'),
      e2e('workspace-canvas.creation-collapsed-space'),
    ],
    matches: path =>
      /contexts\/space\/|usespace(?:drag|ownership|s\.)|space-layout|spacelayout|child-space|pushaway|push-away/.test(
        path,
      ),
  },
  connections: {
    reason: 'Desktop and Web remain interactive on the same Worker and canonical terminal grid.',
    tests: [e2e('workspace-canvas.desktop-web-terminal-consistency')],
    matches: path =>
      /app\/main\/(?:controlsurface|ipc)\/|app\/preload\/|app\/renderer\/browser\/|contexts\/(?:terminal|topology|worker)\/|contracts\/ipc\/|websession|requestauth|authentication/.test(
        path,
      ),
  },
  sidebar: {
    reason: 'Project navigation and sidebar state survive persistence.',
    tests: [e2e('sidebar-tree.persistence'), e2e('project-shortcuts')],
    matches: path => /sidebar|project-shortcut|projectshortcut/.test(path),
  },
  settings: {
    reason: 'Settings remain operable and preserve preferences across restart.',
    tests: [e2e('ui-preferences.persistence'), e2e('settings.visual')],
    matches: path =>
      /contexts\/settings\/|settings-panel|settingspanel|styles\/base\.css/.test(path),
  },
  filesystem: {
    reason: 'Filesystem navigation and dropped nodes retain their intended position.',
    tests: [
      e2e('workspace-canvas.filesystem-drop-position'),
      e2e('workspace-canvas.space-explorer.layout'),
    ],
    matches: path =>
      /filesystem|space-explorer|spaceexplorer|directorybrowser|foldernode|documentnode/.test(path),
  },
}

const expandedTests = [...QUICK_E2E_GROUPS.windows.tests, ...QUICK_E2E_GROUPS.connections.tests]
const isConfiguration = path =>
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json)$/.test(
    path,
  ) ||
  /(?:^|\/)(?:electron\.vite|vite|vitest|playwright)[^/]*\.config\./.test(path) ||
  /^(?:scripts\/|\.github\/|\.husky\/)/.test(path)
const isSource = path =>
  /^(?:src\/|tests\/|harness\/)/.test(path) && /\.(?:[cm]?[jt]sx?|css|json)$/.test(path)

/** Git's NUL-delimited status form preserves spaces and reports both sides of renames. */
export function parseStagedE2EChanges(output) {
  const fields = output.split('\0')
  if (fields.at(-1) === '') {
    fields.pop()
  }
  const changes = []
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++]
    const firstPath = fields[index++]
    if (!status || !firstPath || !/^[ACDMRTUXB][0-9]*$/.test(status)) {
      throw new Error('Invalid staged name-status output.')
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const nextPath = fields[index++]
      if (!nextPath) {
        throw new Error('Incomplete staged rename/copy output.')
      }
      changes.push({ path: firstPath, status: status.startsWith('R') ? 'D' : 'M' })
      changes.push({ path: nextPath, status: 'A' })
    } else {
      changes.push({ path: firstPath, status })
    }
  }
  return changes
}

/** Quick selection is deliberately representative; CI and --full retain every E2E. */
export function selectPrecommitE2E({ changes, full = false }) {
  if (full) {
    return { mode: 'full', groups: [], tests: [] }
  }
  if (changes.length === 0) {
    throw new Error(
      'No staged changes: quick E2E checked NOTHING. Stage changes before running it.',
    )
  }
  const selected = new Map([['core', { ...QUICK_E2E_GROUPS.core, paths: [] }]])
  const expandedPaths = new Set()
  const unmatchedPaths = []
  const add = (id, group, path) => {
    const current = selected.get(id) ?? { ...group, paths: [] }
    current.paths.push(path)
    selected.set(id, current)
  }

  for (const change of changes) {
    const path = change.path.replaceAll('\\', '/')
    const lower = path.toLowerCase()
    let matched = false
    for (const [id, group] of Object.entries(QUICK_E2E_GROUPS)) {
      if (group.matches?.(lower)) {
        add(id, group, path)
        matched = true
      }
    }
    if (change.status !== 'D' && /^tests\/e2e\/.*\.spec\.[cm]?[jt]sx?$/.test(path)) {
      add(
        'changed-tests',
        { reason: 'Run changed Electron E2E files themselves.', tests: [] },
        path,
      )
      selected.get('changed-tests').tests.push(path)
      matched = true
    }
    if (change.status === 'D' || isConfiguration(lower) || (!matched && isSource(lower))) {
      expandedPaths.add(path)
    } else if (!matched) {
      unmatchedPaths.push(path)
    }
  }

  if (expandedPaths.size > 0) {
    selected.set('expanded', {
      reason:
        'Deleted/configuration/unmapped source paths add representative window and Desktop/Web checks; CI still runs the full suite.',
      tests: expandedTests,
      paths: [...expandedPaths],
    })
  }
  const groups = [...selected].map(([id, group]) => ({
    id,
    reason: group.reason,
    tests: [...new Set(group.tests)],
    paths: [...new Set(group.paths)],
  }))
  return {
    mode: 'quick',
    groups,
    tests: [...new Set(groups.flatMap(group => group.tests))],
    unmatchedPaths,
  }
}
