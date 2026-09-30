import { stat } from 'node:fs/promises'
import { dirname, join, win32 } from 'node:path'
import { locateExecutable } from '@platform/process/ExecutableLocator'

/** Resolve common npm/pnpm/Corepack JS entry points without invoking cmd.exe. */
export async function resolvePluginBuildInvocation(
  manager: 'npm' | 'pnpm',
  executable: string,
  platform: NodeJS.Platform,
  node: () => Promise<string>,
  exists: (path: string) => Promise<boolean>,
): Promise<{ command: string; args: string[] }> {
  if (platform !== 'win32' || /\.(exe|com)$/i.test(executable)) {
    return { command: executable, args: [] }
  }
  const path = platform === 'win32' ? win32 : { dirname, join }
  const root = path.dirname(executable)
  const candidates =
    manager === 'npm'
      ? [path.join(root, 'node_modules/npm/bin/npm-cli.js')]
      : [
          path.join(root, 'node_modules/pnpm/bin/pnpm.cjs'),
          path.join(root, 'node_modules/corepack/dist/pnpm.js'),
        ]
  let entry: string | undefined
  for (const candidate of candidates) {
    // At most two filesystem probes; preserve the documented resolution precedence.
    // eslint-disable-next-line no-await-in-loop
    if (await exists(candidate)) {
      entry = candidate
      break
    }
  }
  if (entry) {
    return { command: await node(), args: [entry] }
  }
  throw new Error(
    'Cannot locate the package manager JavaScript entry on this Worker. Use a prebuilt plugin or install a supported npm/pnpm distribution.',
  )
}
export async function pluginBuildInvocation(manager: 'npm' | 'pnpm') {
  const locate = async (command: string) => {
    const result = await locateExecutable({ toolId: `plugin-build-${command}`, command })
    if (!result.executablePath) {
      throw new Error(`Plugin build requires ${command} on the connected Worker.`)
    }
    return result.executablePath
  }
  return resolvePluginBuildInvocation(
    manager,
    await locate(manager),
    process.platform,
    () => locate('node'),
    async path => {
      try {
        return (await stat(path)).isFile()
      } catch {
        return false
      }
    },
  )
}
