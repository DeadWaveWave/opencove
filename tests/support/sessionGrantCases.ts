// The Desktop-to-Worker migration retains these exact CLI inputs as its acceptance oracle.
export const deniedLaunchFields = {
  env: null,
  executablePathOverride: null,
  resumeSessionId: null,
  codexReuseRunningAppServer: false,
  mode: 'new',
  futureOverride: false,
} as const
export const singleTokenLaunchPrompts = ['logout', 'update', 'resume', 'Refactor'] as const
export const providerLaunchCommands = [
  '! printenv X',
  '/permissions change policy',
  '# note',
  '& task',
] as const
export const providerMessageCommands = [
  '! printenv X',
  '/permissions',
  '  /approvals',
  '# note',
] as const
