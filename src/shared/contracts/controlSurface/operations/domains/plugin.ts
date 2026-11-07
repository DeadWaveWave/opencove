import {
  normalizePluginSidebar,
  normalizePluginHost,
  normalizePluginRepository,
} from '../pluginRequestNormalize'
import {
  normalizePluginViewOpen,
  normalizePluginViewClose,
  normalizePluginViewSetTitle,
  normalizePluginInvoke,
  normalizePluginStorageGet,
  normalizePluginStorageSet,
  normalizePluginPreferencesGet,
  normalizePluginPreferencesSet,
  normalizePluginViewPreferencesGet,
  normalizePluginViewPreferencesSet,
} from '../pluginViewNormalize'
import * as z from 'zod'
import {
  pluginListInput,
  pluginDetailsInput,
  pluginInstallInput,
  pluginReloadInput,
  pluginUninstallInput,
  pluginSetEnabledInput,
  pluginWindowOpenInput,
  pluginWindowListInput,
  pluginSkillGetInput,
  pluginCommandRunInput,
  pluginGitInstallInput,
  pluginSourceInput,
  pluginGitCheckInput,
  pluginGitUpdateInput,
  pluginGitApplyInput,
  pluginRollbackInput,
  pluginDiscoverInput,
} from '../pluginNormalize'
import { defineOperation } from '../defineOperation'
// Structural admission uses Zod; legacyNormalize preserves raw-key checks and errors.
export const pluginCommandRunOperation = defineOperation({
  input: z.strictObject({
    pluginId: z.string(),
    projectId: z.string().optional(),
    nodeId: z.string().optional(),
    commandId: z.string(),
    params: z.unknown().optional(),
    viewId: z.string().optional(),
    context: z.unknown().optional(),
    expectedRevision: z.string().optional(),
    expectedRuntimeGeneration: z.unknown().optional(),
  }),
  normalize: pluginCommandRunInput,
  legacyNormalize: pluginCommandRunInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.command.run',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Run a declared plugin command, opening its target window if needed',
})
export const pluginDetailsOperation = defineOperation({
  input: z.looseObject({ pluginId: z.string() }),
  normalize: pluginDetailsInput,
  legacyNormalize: pluginDetailsInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.details',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get a plugin manifest, README, source directory and runtime logs',
})
export const pluginDiscoverOperation = defineOperation({
  input: z.strictObject({ query: z.string().optional() }).nullish(),
  normalize: pluginDiscoverInput,
  legacyNormalize: pluginDiscoverInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.discover',
  kind: 'query',
  scope: 'admin',
  availability: 'always',
  summary: 'Search GitHub for repositories tagged as OpenCove plugins',
})
export const pluginGitApplyOperation = defineOperation({
  input: z.strictObject({ candidateId: z.string() }),
  normalize: pluginGitApplyInput,
  legacyNormalize: pluginGitApplyInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.git.apply',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Build and publish a prepared plugin Git candidate',
})
export const pluginGitCheckOperation = defineOperation({
  input: z.strictObject({ pluginId: z.string(), ref: z.string().optional() }),
  normalize: pluginGitCheckInput,
  legacyNormalize: pluginGitCheckInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.git.check',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Check a managed plugin source for upstream Git updates',
})
export const pluginGitInstallOperation = defineOperation({
  input: z.strictObject({
    repository: z.string(),
    ref: z.string().optional(),
    directory: z.string().optional(),
    build: z.unknown().optional(),
  }),
  normalize: pluginGitInstallInput,
  legacyNormalize: pluginGitInstallInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.git.install',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Clone, build and install a plugin from a Git repository',
})
export const pluginGitUpdateOperation = defineOperation({
  input: z.strictObject({ pluginId: z.string(), ref: z.string().optional() }),
  normalize: pluginGitUpdateInput,
  legacyNormalize: pluginGitUpdateInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.git.update',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Merge upstream changes and publish a plugin unless conflicts remain',
})
export const pluginHostRequestOperation = defineOperation({
  input: z.strictObject({
    viewId: z.string().describe('Plugin view identifier declared in the plugin manifest'),
    operation: z.string().describe('Host capability operation'),
    payload: z
      .unknown()
      .optional()
      .describe('Host request JSON, validated by pluginJsonValue, at most 2 MiB'),
  }),
  normalize: normalizePluginHost,
  legacyNormalize: normalizePluginHost,
  errors: [
    'plugin.operation_failed',
    'filesystem.create_directory_failed',
    'filesystem.read_file_bytes_failed',
    'filesystem.read_file_text_failed',
    'filesystem.write_file_text_failed',
    'filesystem.copy_entry_failed',
    'filesystem.move_entry_failed',
    'filesystem.rename_entry_failed',
    'filesystem.delete_entry_failed',
    'filesystem.read_directory_failed',
    'filesystem.stat_failed',
  ],
  id: 'plugin.host.request',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Dispatch a host capability request on behalf of a plugin view',
})
export const pluginInstallOperation = defineOperation({
  input: z.looseObject({ directory: z.string() }),
  normalize: pluginInstallInput,
  legacyNormalize: pluginInstallInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.install',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Install a plugin from a local source directory',
})
export const pluginInvokeOperation = defineOperation({
  input: z.looseObject({
    viewId: z.string().describe('Plugin view identifier declared in the plugin manifest'),
    method: z.string().describe('Backend method name'),
    params: z.unknown().optional().describe('JSON backend parameters, limited to 1 MiB'),
  }),
  normalize: normalizePluginInvoke,
  legacyNormalize: normalizePluginInvoke,
  errors: ['plugin.operation_failed'],
  id: 'plugin.invoke',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Invoke a plugin backend method on behalf of an open view',
})
export const pluginListOperation = defineOperation({
  input: z.unknown(),
  normalize: pluginListInput,
  legacyNormalize: pluginListInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List installed plugins with their manifests and runtime status',
})
export const pluginPreferencesGetOperation = defineOperation({
  input: z.strictObject({ pluginId: z.string().describe('Installed plugin identifier') }),
  normalize: normalizePluginPreferencesGet,
  legacyNormalize: normalizePluginPreferencesGet,
  errors: ['plugin.operation_failed'],
  id: 'plugin.preferences.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read configured preference values for an installed plugin',
})
export const pluginPreferencesSetOperation = defineOperation({
  input: z.strictObject({
    pluginId: z.string().describe('Installed plugin identifier'),
    key: z.string().describe('Preference key'),
    value: z
      .unknown()
      .optional()
      .describe('Preference value validated by the plugin preference owner'),
  }),
  normalize: normalizePluginPreferencesSet,
  legacyNormalize: normalizePluginPreferencesSet,
  errors: ['plugin.operation_failed'],
  id: 'plugin.preferences.set',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Save a named preference value for an installed plugin',
})
export const pluginReloadOperation = defineOperation({
  input: z.looseObject({ pluginId: z.string() }),
  normalize: pluginReloadInput,
  legacyNormalize: pluginReloadInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.reload',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Rebuild a managed Git plugin or reload its local source',
})
export const pluginRepositoryDetailsOperation = defineOperation({
  input: z.strictObject({
    repository: z.string().describe('GitHub repository to inspect'),
  }),
  normalize: normalizePluginRepository,
  legacyNormalize: normalizePluginRepository,
  errors: ['plugin.operation_failed'],
  id: 'plugin.repository.details',
  kind: 'query',
  scope: 'admin',
  availability: 'always',
  summary: 'Inspect a GitHub plugin repository before installation',
})
export const pluginRollbackOperation = defineOperation({
  input: z.strictObject({ pluginId: z.string(), revision: z.string() }),
  normalize: pluginRollbackInput,
  legacyNormalize: pluginRollbackInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.rollback',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Restore a retained plugin code revision as the active installation',
})
export const pluginSetEnabledOperation = defineOperation({
  input: z.looseObject({ pluginId: z.string(), enabled: z.boolean() }),
  normalize: pluginSetEnabledInput,
  legacyNormalize: pluginSetEnabledInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.setEnabled',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Enable or disable an installed plugin and its runtime',
})
export const pluginSidebarItemsOperation = defineOperation({
  input: z.strictObject({
    pluginId: z.string().describe('Installed plugin identifier'),
    sectionId: z.string().describe('Sidebar section identifier declared by the plugin'),
    projectId: z.string().describe('Project whose sidebar section is shown'),
    expectedRevision: z
      .string()
      .describe('Plugin revision the caller rendered; a stale revision is rejected'),
    expectedRuntimeGeneration: z.number().describe('Current plugin runtime generation'),
  }),
  normalize: normalizePluginSidebar,
  legacyNormalize: normalizePluginSidebar,
  errors: ['plugin.operation_failed'],
  id: 'plugin.sidebar.items',
  kind: 'query',
  // Runs a plugin command; the backend is not a read-only projection.
  scope: 'interact',
  availability: 'always',
  summary: 'Run a plugin command to populate a project Sidebar section',
})
export const pluginSkillGetOperation = defineOperation({
  input: z.strictObject({ pluginId: z.string(), skillId: z.string() }),
  normalize: pluginSkillGetInput,
  legacyNormalize: pluginSkillGetInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.skill.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read a declared skill from an installed plugin',
})
export const pluginSourceOperation = defineOperation({
  input: z.strictObject({ pluginId: z.string() }),
  normalize: pluginSourceInput,
  legacyNormalize: pluginSourceInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.source',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Inspect plugin source changes, revision history and pending candidates',
})
export const pluginStorageGetOperation = defineOperation({
  input: z.looseObject({
    viewId: z.string().describe('Plugin view identifier declared in the plugin manifest'),
    key: z.string().describe('Storage key'),
    value: z.unknown().optional().describe('Ignored by reads; retained for compatibility'),
  }),
  normalize: normalizePluginStorageGet,
  legacyNormalize: normalizePluginStorageGet,
  errors: ['plugin.operation_failed'],
  id: 'plugin.storage.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read a plugin storage value through an open view',
})
export const pluginStorageSetOperation = defineOperation({
  input: z.looseObject({
    viewId: z.string().describe('Plugin view identifier declared in the plugin manifest'),
    key: z.string().describe('Storage key'),
    value: z.unknown().optional().describe('JSON value, limited to 1 MiB'),
  }),
  normalize: normalizePluginStorageSet,
  legacyNormalize: normalizePluginStorageSet,
  errors: ['plugin.operation_failed'],
  id: 'plugin.storage.set',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist a plugin storage value through an open view',
})
export const pluginUninstallOperation = defineOperation({
  input: z.looseObject({ pluginId: z.string() }),
  normalize: pluginUninstallInput,
  legacyNormalize: pluginUninstallInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.uninstall',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Uninstall a plugin and dispose its active runtime',
})
export const pluginViewCloseOperation = defineOperation({
  input: z.looseObject({
    viewId: z.string().describe('Plugin view identifier declared in the plugin manifest'),
  }),
  normalize: normalizePluginViewClose,
  legacyNormalize: normalizePluginViewClose,
  errors: ['plugin.operation_failed'],
  id: 'plugin.view.close',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Close a plugin runtime view and release its resources',
})
export const pluginViewOpenOperation = defineOperation({
  input: z.looseObject({
    pluginId: z.string().describe('Installed plugin identifier'),
    nodeId: z.string().describe('Canvas node that hosts the plugin view'),
    workspaceId: z.string().nullish().describe('Workspace owning the node'),
    directoryPath: z.string().nullish().describe('Working directory'),
    preview: z.boolean().optional().describe('Open a preview view'),
  }),
  normalize: normalizePluginViewOpen,
  legacyNormalize: normalizePluginViewOpen,
  errors: ['plugin.operation_failed'],
  id: 'plugin.view.open',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Open a plugin runtime view bound to a canvas node',
})
export const pluginViewPreferencesGetOperation = defineOperation({
  input: z.strictObject({
    viewId: z.string().describe('Plugin view identifier declared in the plugin manifest'),
  }),
  normalize: normalizePluginViewPreferencesGet,
  legacyNormalize: normalizePluginViewPreferencesGet,
  errors: ['plugin.operation_failed'],
  id: 'plugin.view.preferences.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read plugin preferences through an open view',
})
export const pluginViewPreferencesSetOperation = defineOperation({
  input: z.strictObject({
    viewId: z.string().describe('Plugin view identifier declared in the plugin manifest'),
    key: z.string().describe('Preference key'),
    value: z
      .unknown()
      .optional()
      .describe('Preference value validated by the plugin preference owner'),
  }),
  normalize: normalizePluginViewPreferencesSet,
  legacyNormalize: normalizePluginViewPreferencesSet,
  errors: ['plugin.operation_failed'],
  id: 'plugin.view.preferences.set',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Save a plugin preference through an open view',
})
export const pluginViewSetTitleOperation = defineOperation({
  input: z.looseObject({
    viewId: z.string().describe('Plugin view identifier declared in the plugin manifest'),
    title: z.string().describe('New window title'),
  }),
  normalize: normalizePluginViewSetTitle,
  legacyNormalize: normalizePluginViewSetTitle,
  errors: ['plugin.operation_failed'],
  id: 'plugin.view.setTitle',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Change the title of an open plugin view',
})
export const pluginWindowListOperation = defineOperation({
  input: z.strictObject({ pluginId: z.string(), projectId: z.string().optional() }),
  normalize: pluginWindowListInput,
  legacyNormalize: pluginWindowListInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.window.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List plugin canvas windows with their current view titles',
})
export const pluginWindowOpenOperation = defineOperation({
  input: z.strictObject({
    pluginId: z.string(),
    projectId: z.string().optional(),
    nodeId: z.string().optional(),
    spaceId: z.string().optional(),
    anchor: z.looseObject({ x: z.number(), y: z.number() }).optional(),
  }),
  normalize: pluginWindowOpenInput,
  legacyNormalize: pluginWindowOpenInput,
  errors: ['plugin.operation_failed'],
  id: 'plugin.window.open',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create or reuse a plugin canvas window and focus it',
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
