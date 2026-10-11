export const enSettingsPanelPlugins = {
  emptyTitle: 'Your tools belong here',
  emptyHelp:
    'Install a plugin to add a canvas tool, commands or Skills. The documentation library helps you get started.',
  library: {
    articles: {
      overview: {
        title: 'Plugin guide',
        description: 'The complete introduction and CLI command index.',
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
      'Install ready-to-run files from a repository you trust. Packages requiring a build can be installed with the CLI build options.',
    localHelp:
      'Use an absolute directory on the connected runtime machine. Source files remain yours.',
    working: 'Working…',
    search: 'Search GitHub',
    confirm: 'Install plugin',
    failed: 'The plugin could not be installed.',
    noResults: 'No matching repositories. Try another search.',
    choose: 'Choose repository',
  },
  source: {
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
    title: 'Show in',
    help: 'Choose where to show this plugin. Existing windows stay unchanged.',
    actionBar: 'Show in action bar',
    actionBarDescription: 'On the right side of the canvas',
    contextMenu: 'Show in right-click menu',
    contextMenuDescription: 'In the menu on an empty canvas area',
  },
  capabilities: {
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
