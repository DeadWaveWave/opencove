import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { transformWithEsbuild } from 'vite'

/** Compile the real child entry and its boundary codec without depending on stale app output. */
export async function writePluginHostTestFixture(root: string): Promise<string> {
  await Promise.all(
    [
      ['infrastructure/pluginHostEntry.ts', 'infrastructure/pluginHostEntry.mjs'],
      ['infrastructure/PluginBackendHostClient.ts', 'infrastructure/PluginBackendHostClient.js'],
      ['domain/pluginJsonValue.ts', 'domain/pluginJsonValue.js'],
      ['domain/pluginHostApi.ts', 'domain/pluginHostApi.js'],
    ].map(async ([source, output]) => {
      const transformed = await transformWithEsbuild(
        await readFile(resolve('src/contexts/plugins', source), 'utf8'),
        source,
        { loader: 'ts', format: 'esm', target: 'node22' },
      )
      const path = join(root, 'host', output)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, transformed.code)
    }),
  )
  return join(root, 'host/infrastructure/pluginHostEntry.mjs')
}
