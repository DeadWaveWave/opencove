export const enSettingsPanelAgentExecutable = {
  title: 'Agent Executable Resolution',
  help: 'Inspect host-side diagnostics for each local agent CLI. Agent launches use the selected terminal profile, so an unavailable host probe is not always a launch blocker.',
  overrideLabel: 'Executable Override',
  overrideHelp:
    'Optional local path override for this provider. When set, OpenCove requires it to resolve successfully.',
  overridePlaceholder: '/absolute/path/to/executable',
  pathLabel: 'Resolved Path',
  notResolved: 'Not resolved',
  commandLabel: 'Command: {{command}}',
  status: {
    available: 'Available',
    unavailable: 'Unavailable',
    misconfigured: 'Misconfigured',
  },
}
