import type { PluginManifest } from '../../domain/pluginTypes'

export const examplePlugin: PluginManifest = {
  id: 'example-tool',
  displayName: 'Example Tool',
  description: 'A tool beside your work.',
  version: '1.0.0',
  source: 'local',
  author: 'Example author',
  nodeKinds: ['example-tool'],
  actionBar: true,
  contextMenu: true,
  enabled: true,
  status: 'ready',
  hasPreview: true,
  icon: { type: 'builtin', name: 'puzzle' },
}
export const exampleDetails = {
  plugin: examplePlugin,
  readme: '# Your tool\n\n![Example](./example.svg)',
  assets: { './example.svg': '/example.svg' },
  sourceDirectory: '/plugins/example-tool',
  logs: [],
}
