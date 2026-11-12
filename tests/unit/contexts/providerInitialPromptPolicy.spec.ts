import { expect, it } from 'vitest'
import registry from '../../fixtures/provider-argv/claudeRegistry.json'
import { assertProviderInitialPrompt } from '../../../src/contexts/agent/domain/providerInitialPromptPolicy'

it.each(registry)('refuses Claude root dispatch %s', prompt => {
  expect(() => assertProviderInitialPrompt('claude-code', prompt)).toThrow()
})
it.each(['--agent-teams', '--hard-fail', '--help', '-p', '-', '--'])(
  'refuses raw Claude flag %s',
  prompt => {
    expect(() => assertProviderInitialPrompt('claude-code', prompt)).toThrow()
  },
)
it.each(['install', 'remove', 'uninstall', 'update', 'list', 'config', '--help', '-p', '@file'])(
  'refuses Pi dispatch %s',
  prompt => {
    expect(() => assertProviderInitialPrompt('pi', prompt)).toThrow()
  },
)
it.each([
  'help',
  'logout',
  'resume',
  'Refactor',
  'update the project',
  'cc://localhost',
  '/help',
  'exit',
  'a\r\n中文 " $ ` ;',
])('preserves ordinary Claude input %j', prompt => {
  expect(() => assertProviderInitialPrompt('claude-code', prompt)).not.toThrow()
})
