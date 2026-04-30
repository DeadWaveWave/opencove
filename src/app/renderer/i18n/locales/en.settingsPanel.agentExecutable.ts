export const enSettingsPanelAgentExecutable = {
  title: 'Agent Executable Resolution',
  help: 'Inspect how OpenCove resolves each local agent CLI, and set an explicit executable path when auto-detection is wrong.',
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
