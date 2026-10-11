export const enSettingsPanelPlugins = {
  emptyTitle: 'Your tools belong here',
  emptyHelp:
    'Install a plugin to add a canvas tool, commands or Skills. The documentation library helps you get started.',
  library: {
    articles: {
      HOST_API: {
        title: 'Host API map',
        description: 'All capabilities, explicit targets and resource lifetimes.',
      },
      FILESYSTEM: {
        title: 'Files and watches',
        description: 'Local and remote file operations and sampled directory changes.',
      },
      CANVAS_API: {
        title: 'Nodes and sessions',
        description: 'Create, address and control canvas nodes, terminals and Agents.',
      },
      EVENTS: {
        title: 'Lifecycle subscriptions',
        description: 'Bounded snapshot changes and explicit subscription cleanup.',
      },
      SIDEBAR: {
        title: 'Sidebar trees',
        description: 'Declarative project sections and backend item actions.',
      },
      overview: {
        title: 'Plugin guide',
        description: 'The complete introduction and CLI command index.',
      },
      THEMES: {
        title: 'Theme development',
        description: 'Foundations, materials, component skins and motion.',
      },
      HOST_EXTENSIONS: {
        title: 'Host contributions',
        description: 'Plugin preferences, themes, menus and stable host boundaries.',
      },
      DISTRIBUTION: {
        title: 'Git distribution',
        description: 'Discover, install, update and restore plugin code.',
      },
      TARGETS: {
        title: 'Projects and execution',
        description: 'Local and remote files, explicit targets and cancellable work.',
      },
      COMPATIBILITY: {
        title: 'Compatibility and releases',
        description: 'Worker versions, supported platforms and plugin data migrations.',
      },
      ROADMAP: {
        title: 'Plugin roadmap',
        description: 'Current capabilities and the next development priorities.',
      },

      start: {
        title: 'What plugins can do',
        description: 'Canvas tools, Agent commands and a place for your workflow.',
      },
      install: {
        build: 'Build strategy',
        prebuilt: 'Ready-to-run files',
        script: 'Package script',
        output: 'Build output directory',
        buildHelp:
          'npm requires package-lock.json; pnpm requires pnpm-lock.yaml. Dependencies install with lifecycle scripts disabled, then the chosen script runs with normal Worker permissions.',

        title: 'Install and use',
        description: 'Install a package, choose its shortcuts and keep your data.',
      },
      build: {
        title: 'Build your first plugin',
        description: 'A hands-on walkthrough with the working Hello Clock example.',
      },
      reference: {
        title: 'Find your reference',
        description: 'Find the matching API, design guide and commands for your Agent.',
      },
      authoring: {
        title: 'Authoring and verification',
        description: 'Runtime setup, iteration and acceptance checks.',
      },
      api: {
        title: 'Plugin API',
        description: 'Manifest, view SDK, backend and storage contracts.',
      },
      design: {
        title: 'Visual design system',
        description: 'Layout, themes, typography and the control baseline.',
      },
      commands: {
        title: 'Commands and skills',
        description: 'Declared operations, window targeting and Agent automation.',
      },
      example: {
        title: 'Hello Clock example',
        description: 'Files and behaviors in the runnable starter package.',
      },
      runtime: {
        title: 'Runtime ownership',
        description: 'Host developer reference: installations, views and backends.',
      },
    },
    button: 'Documentation',
    title: 'Plugin library',
    description:
      'Learn what plugins can do, follow a tutorial, or find the reference for your next tool. Available offline with this build.',
    back: 'All documentation',
    start: 'Get started',
    tutorial: 'Make something',
    reference: 'Technical reference',
  },
  install: {
    build: 'Build strategy',
    prebuilt: 'Ready-to-run files',
    script: 'Package script',
    output: 'Build output directory',
    buildHelp:
      'npm requires package-lock.json; pnpm requires pnpm-lock.yaml. Dependencies install with lifecycle scripts disabled, then the chosen script runs with normal Worker permissions.',

    title: 'Install plugin',
    close: 'Close installation',
    source: 'Plugin source',
    git: 'Git repository',
    local: 'Local directory',
    discover: 'Discover',
    searchLabel: 'Find plugins on GitHub',
    discoveryHelp:
      'Search public repositories. Review a project before choosing it; selecting a result does not install it.',
    repository: 'Repository URL',
    directory: 'Directory on the runtime machine',
    options: 'Optional repository settings',
    ref: 'Branch, tag or commit',
    packageDirectory: 'Plugin directory within repository',
    gitHelp:
      'Install from a repository you trust. Use optional settings when its README requires a package directory or build.',
    localHelp:
      'Use an absolute directory on the connected runtime machine. Source files remain yours.',
    working: 'Working…',
    search: 'Search GitHub',
    confirm: 'Install plugin',
    failed: 'The plugin could not be installed.',
    noResults: 'No matching repositories. Try another search.',
    choose: 'Choose repository',
  },
  repository: {
    back: 'Search results',
    loading: 'Reading repository…',
    details: 'View details',
    choose: 'Use this reviewed commit',
    hostVersion: 'OpenCove version',
    platforms: 'Worker systems',
    allPlatforms: 'All systems (not independently verified)',
    notDeclared: 'Not declared',
    readOnly:
      'Repository content only. Nothing is installed or executed here. Installation uses the commit shown above; you can change its build options next.',
    noReadme: 'No README was found at this revision.',
  },
  source: {
    installCandidateHelp:
      'No version was installed. The working copy is retained so you can correct the reported problem and explicitly apply it.',
    candidateFailed: 'Build or activation failed',
    updateRef: 'Update branch, tag or commit',
    candidates: 'Updates needing attention',
    candidateHelp:
      'Your current version keeps running. Review the separate working copy, resolve and commit conflicts, then apply it explicitly.',
    conflict: 'Merge conflict',
    prepared: 'Ready for review',
    stale: 'Candidate is out of date',
    staleHelp:
      'The installation or original source changed. Prepare a fresh update and carry over any reviewed resolution; this candidate cannot replace the current version.',
    inspectCandidate: 'Inspect working copy',
    workerDirectory:
      'This directory is on the connected Worker. It is separate from your active source.',
    copyPath: 'Copy directory',
    applyCandidate: 'Apply resolved candidate',
    copyResolution: 'Copy resolution instructions',
    resolvePrompt:
      'Inspect the OpenCove plugin candidate at {{directory}} on the connected Worker. Read opencove plugin guide first. Resolve merge conflicts or the reported build problem, review the changes, and commit the resolution. Do not reset or overwrite the original source. Apply only when ready with: opencove plugin apply {{candidate}}. If the candidate is stale, prepare a fresh update and preserve the reviewed changes.',

    repository: 'Repository',
    dirty: 'Your source has local changes. An update merges in a separate working copy.',
    check: 'Check for updates',
    update: 'Apply update',
    available:
      'An upstream update is available. Your current version stays active until the update succeeds.',
    current: 'This source is up to date.',
    failed: 'The update did not complete. Your current version is still active.',
    history: 'Previous versions',
    rollbackHelp:
      'Restore plugin code from a saved version. Your data is kept and is not rolled back.',
    revision: 'Saved version',
    choose: 'Choose a version',
    rollback: 'Restore version',
  },
  tools: {
    commands: 'Commands',
    skills: 'Skills',
    skillsHelp:
      'Give the installation prompt to your Agent to choose its skill directory and install.',
    copySkill: 'Copy installation prompt',
    copyCommand: 'Copy {{name}} command',
    copy: 'Copy',
    copied: 'Copied',
    withoutWindow: 'Runs without opening a window.',
    selectedWindow: 'Specify a node. If it is open on multiple devices, specify a view too.',
    singleWindow:
      'Reuses one window across projects on this Worker. Creating it requires a project.',
  },
  installedTitle: 'Installed',
  installedHelp:
    'Choose a plugin to read its documentation and manage its controls. Disabling keeps its windows and data.',
  builtIn: 'Built-in',
  local: 'Local plugin',
  refresh: 'Refresh plugins',
  reload: 'Reload',
  uninstall: 'Uninstall',
  uninstallHelp: 'Source files, saved data, and canvas nodes stay available for reinstalling.',
  logs: 'Runtime logs',
  runtime: {
    loading: 'Loading plugin…',
    failed: 'Plugin could not start',
    retry: 'Retry',
    manage: 'Manage local plugin',
  },
  version: 'Version {{version}}',
  enable: 'Enable {{name}}',
  enabled: 'Enabled',
  disabled: 'Disabled',
  back: 'All plugins',
  details: 'View {{name}} details',
  documentation: 'Plugin documentation',
  preview: {
    start: 'Start preview',
    stop: 'Close preview',
    localHint: 'Uses separate preview data. Closing stops the preview.',

    title: 'Live preview',
    hint: 'Drag, resize, or collapse the window to try it.',
    reset: 'Reset preview',
    restore: 'Restore window',
    sample: 'Sample repository',
    unavailable: 'Preview unavailable',
    closed: 'Preview window closed',
    updated: 'Preview refreshed',
  },
  capabilitiesLabel: 'Available in',
  contributions: {
    sidebar: 'Show in Sidebar',
    sidebarDescription: 'Show this plugin’s sections in the project Sidebar.',
    title: 'Show in',
    help: 'Choose where to show this plugin. Existing windows stay unchanged.',
    actionBar: 'Show in action bar',
    actionBarDescription: 'On the right side of the canvas',
    contextMenu: 'Show in right-click menu',
    contextMenuDescription: 'In the menu on an empty canvas area',
  },
  capabilities: {
    sidebar: 'Sidebar',
    preferences: 'Preferences',
    themes: 'Themes',
    canvas: 'Canvas node',
    actionBar: 'Action bar',
    contextMenu: 'Right-click menu',
  },
  guideTitle: 'Build a plugin',
  guideHelp:
    'Run this command in a terminal, or share it with your Agent, to find the plugin README and development files.',
  copyGuide: 'Copy guide command',
  copied: 'Command copied',
  copyFailed: 'Could not copy the command. Select and copy the command above.',
} as const
