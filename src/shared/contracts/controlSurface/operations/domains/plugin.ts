import { defineLegacyOperation } from '../defineOperation'
export const pluginCommandRunOperation = defineLegacyOperation({
  id: 'plugin.command.run',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin command run.',
})
export const pluginDetailsOperation = defineLegacyOperation({
  id: 'plugin.details',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform plugin details.',
})
export const pluginDiscoverOperation = defineLegacyOperation({
  id: 'plugin.discover',
  kind: 'query',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin discover.',
})
export const pluginGitApplyOperation = defineLegacyOperation({
  id: 'plugin.git.apply',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin git apply.',
})
export const pluginGitCheckOperation = defineLegacyOperation({
  id: 'plugin.git.check',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin git check.',
})
export const pluginGitInstallOperation = defineLegacyOperation({
  id: 'plugin.git.install',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin git install.',
})
export const pluginGitUpdateOperation = defineLegacyOperation({
  id: 'plugin.git.update',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin git update.',
})
export const pluginHostRequestOperation = defineLegacyOperation({
  id: 'plugin.host.request',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin host request.',
})
export const pluginInstallOperation = defineLegacyOperation({
  id: 'plugin.install',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin install.',
})
export const pluginInvokeOperation = defineLegacyOperation({
  id: 'plugin.invoke',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin invoke.',
})
export const pluginListOperation = defineLegacyOperation({
  id: 'plugin.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query plugin list.',
})
export const pluginPreferencesGetOperation = defineLegacyOperation({
  id: 'plugin.preferences.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query plugin preferences get.',
})
export const pluginPreferencesSetOperation = defineLegacyOperation({
  id: 'plugin.preferences.set',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin preferences set.',
})
export const pluginReloadOperation = defineLegacyOperation({
  id: 'plugin.reload',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin reload.',
})
export const pluginRepositoryDetailsOperation = defineLegacyOperation({
  id: 'plugin.repository.details',
  kind: 'query',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin repository details.',
})
export const pluginRollbackOperation = defineLegacyOperation({
  id: 'plugin.rollback',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin rollback.',
})
export const pluginSetEnabledOperation = defineLegacyOperation({
  id: 'plugin.setEnabled',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin set Enabled.',
})
export const pluginSidebarItemsOperation = defineLegacyOperation({
  id: 'plugin.sidebar.items',
  kind: 'query',
  // Runs a plugin command; the backend is not a read-only projection.
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin sidebar items.',
})
export const pluginSkillGetOperation = defineLegacyOperation({
  id: 'plugin.skill.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query plugin skill get.',
})
export const pluginSourceOperation = defineLegacyOperation({
  id: 'plugin.source',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform plugin source.',
})
export const pluginStorageGetOperation = defineLegacyOperation({
  id: 'plugin.storage.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query plugin storage get.',
})
export const pluginStorageSetOperation = defineLegacyOperation({
  id: 'plugin.storage.set',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin storage set.',
})
export const pluginUninstallOperation = defineLegacyOperation({
  id: 'plugin.uninstall',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform plugin uninstall.',
})
export const pluginViewCloseOperation = defineLegacyOperation({
  id: 'plugin.view.close',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin view close.',
})
export const pluginViewOpenOperation = defineLegacyOperation({
  id: 'plugin.view.open',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin view open.',
})
export const pluginViewPreferencesGetOperation = defineLegacyOperation({
  id: 'plugin.view.preferences.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query plugin view preferences get.',
})
export const pluginViewPreferencesSetOperation = defineLegacyOperation({
  id: 'plugin.view.preferences.set',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin view preferences set.',
})
export const pluginViewSetTitleOperation = defineLegacyOperation({
  id: 'plugin.view.setTitle',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin view set Title.',
})
export const pluginWindowListOperation = defineLegacyOperation({
  id: 'plugin.window.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query plugin window list.',
})
export const pluginWindowOpenOperation = defineLegacyOperation({
  id: 'plugin.window.open',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform plugin window open.',
})
export const pluginOperations = [
  pluginCommandRunOperation,
  pluginDetailsOperation,
  pluginDiscoverOperation,
  pluginGitApplyOperation,
  pluginGitCheckOperation,
  pluginGitInstallOperation,
  pluginGitUpdateOperation,
  pluginHostRequestOperation,
  pluginInstallOperation,
  pluginInvokeOperation,
  pluginListOperation,
  pluginPreferencesGetOperation,
  pluginPreferencesSetOperation,
  pluginReloadOperation,
  pluginRepositoryDetailsOperation,
  pluginRollbackOperation,
  pluginSetEnabledOperation,
  pluginSidebarItemsOperation,
  pluginSkillGetOperation,
  pluginSourceOperation,
  pluginStorageGetOperation,
  pluginStorageSetOperation,
  pluginUninstallOperation,
  pluginViewCloseOperation,
  pluginViewOpenOperation,
  pluginViewPreferencesGetOperation,
  pluginViewPreferencesSetOperation,
  pluginViewSetTitleOperation,
  pluginWindowListOperation,
  pluginWindowOpenOperation,
] as const
