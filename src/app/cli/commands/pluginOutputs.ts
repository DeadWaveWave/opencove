import type { RenderSpec } from '../core/command'
import { declaredOutput } from './declaredOutput'

// PluginManifest / PluginDetails / PluginDistributionResult and plugin window receipts.
const manifestFields = [
  'id',
  'version',
  'displayName',
  'description',
  'icon',
  'nodeKinds',
  'actionBar',
  'contextMenu',
  'source',
  'author',
  'revision',
  'runtimeGeneration',
  'enabled',
  'status',
  'error',
  'view',
  'hasPreview',
  'commands',
  'skills',
  'preferences',
  'sidebar',
  'themes',
  'icon.type',
  'icon.name',
  'icon.path',
  'icon.light',
  'icon.dark',
  'view.entry',
  'view.instances',
  'view.kind',
  'view.width',
  'view.height',
  'view.minWidth',
  'view.minHeight',
]
const manifest = declaredOutput(manifestFields, { id: 'sample' })
const distribution = declaredOutput(
  manifestFields,
  {
    status: 'installed',
    candidateId: 'c',
    candidateDirectory: '/plugins/c',
    plugin: { id: 'sample' },
  },
  { itemKey: 'plugin' },
)
const windowFields = ['nodeId', 'projectId', 'spaceId', 'title', 'titlePinnedByUser']
export const pluginOutputs: Record<string, RenderSpec> = {
  list: declaredOutput(manifestFields, { plugins: [{ id: 'sample' }] }, { listKey: 'plugins' }),
  details: declaredOutput(
    manifestFields,
    {
      plugin: { id: 'sample' },
      readme: 'Documentation',
      assets: {},
      sourceDirectory: null,
      logs: [],
    },
    { itemKey: 'plugin' },
  ),
  install: manifest,
  reload: declaredOutput(
    manifestFields,
    {
      status: 'updated',
      candidateId: 'c',
      candidateDirectory: '/plugins/c',
      plugin: { id: 'sample' },
    },
    { itemKey: 'plugin', itemAtRoot: true },
  ),
  uninstall: declaredOutput(['ok'], { ok: true }),
  enable: manifest,
  disable: manifest,
  'install-git': distribution,
  update: distribution,
  apply: distribution,
  rollback: manifest,
  source: declaredOutput(
    [
      'pluginId',
      'sourceDirectory',
      'distribution',
      'distribution.kind',
      'distribution.repository',
      'distribution.ref',
      'distribution.upstreamCommit',
      'distribution.checkoutCommit',
      'distribution.directory',
      'distribution.packageDirectory',
      'distribution.build',
      'dirty',
      'headCommit',
      'history',
      'candidates',
    ],
    { pluginId: 'sample' },
  ),
  check: declaredOutput(['currentCommit', 'availableCommit', 'ref', 'updateAvailable'], {
    currentCommit: 'abc',
  }),
  discover: declaredOutput(
    ['name', 'url', 'description', 'stars', 'updatedAt'],
    { repositories: [{ name: 'sample' }], source: 'github', installAutomatically: false },
    { listKey: 'repositories' },
  ),
  run: {
    unavailable:
      'Plugin commands define their own results, so fields cannot be validated before execution. Omit --fields to receive the complete result.',
  },
  skill: declaredOutput(
    ['id', 'description', 'path'],
    {
      pluginId: 'sample',
      skill: { id: 'usage' },
      content: 'Instructions',
      path: '/plugins/sample/usage.md',
      installPrompt: 'Use this skill',
    },
    { itemKey: 'skill' },
  ),
  open: declaredOutput([...windowFields, 'created', 'revision', 'deliveredClientCount'], {
    nodeId: 'n',
  }),
  windows: declaredOutput(
    [...windowFields, 'savedTitle', 'views'],
    { windows: [{ nodeId: 'n' }] },
    { listKey: 'windows' },
  ),
  guide: declaredOutput(['directory', 'readme'], { directory: '/plugins/guide' }),
}
