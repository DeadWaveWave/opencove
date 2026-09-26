import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILTIN_PLUGIN_GUIDES = [
  {
    id: 'git-board',
    manifestVersion: '0.1.0',
    document: 'GIT_BOARD_MVP.md',
  },
]

/**
 * Resolve the versioned plugin documentation next to the packaged CLI.
 *
 * electron-builder keeps `src/app/cli` and `docs/plugins` at the same app
 * root, whether that root is app.asar or an unpacked `app` directory. Keeping
 * this calculation relative to the CLI also makes the source checkout and the
 * packaged app use exactly the same path contract.
 */
export function resolvePluginGuideDirectory(scriptPath = fileURLToPath(import.meta.url)) {
  return join(dirname(scriptPath), '..', '..', '..', 'docs', 'plugins')
}

export function createPluginGuideResult(pluginDirectory = resolvePluginGuideDirectory()) {
  return {
    directory: pluginDirectory,
    readme: join(pluginDirectory, 'README.md'),
    plugins: BUILTIN_PLUGIN_GUIDES.map(plugin => ({
      ...plugin,
      document: join(pluginDirectory, plugin.document),
    })),
  }
}
