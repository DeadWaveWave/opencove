import type { AgentProviderId } from '../../../shared/contracts/dto'
import { createAppError } from '../../../shared/errors/appError'
import { terminalSpawnApplicationDescriptor } from '../../../shared/errors/terminalSpawnErrorReasons'

// Claude Code 2.1.322 root registrations (including hidden/conditional commands and aliases).
// Its Commander dispatches exact command names even after --. No implicit help: root has action.
const claudeCommands = new Set([
  'gateway',
  'mcp',
  'xaa',
  'edit-hook',
  'edit-permission-rules',
  'edit-memory-settings',
  'edit-skill-overrides',
  'edit-sandbox-settings',
  'design-login',
  'edit-chrome-settings',
  'drop-worktree-registrations',
  'auth',
  'purge',
  'project',
  'plugin',
  'setup-token',
  'agents',
  'ultrareview',
  'auto-mode',
  'remote-control',
  'rc',
  'doctor',
  'apply-project-settings',
  'sandbox',
  'update',
  'upgrade',
  'install',
  'import',
  'import-conversations',
])
const piCommands = new Set(['install', 'remove', 'uninstall', 'update', 'list', 'config'])

/** Pure preflight shared by UI and provider planners. Resume callers must omit initial text. */
export function assertProviderInitialPrompt(provider: AgentProviderId, text: string): void {
  const prompt = text.trim()
  const refused =
    provider === 'claude-code'
      ? prompt.startsWith('-') || claudeCommands.has(prompt)
      : provider === 'pi'
        ? prompt.startsWith('-') || prompt.startsWith('@') || piCommands.has(prompt)
        : false
  if (refused) {
    throw createAppError(terminalSpawnApplicationDescriptor('initial_prompt_unsupported'))
  }
}
