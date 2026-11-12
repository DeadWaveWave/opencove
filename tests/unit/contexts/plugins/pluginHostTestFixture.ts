import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { transformWithEsbuild } from 'vite'

/**
 * Compile the real child entry and its boundary codec without depending on stale app output.
 * Files keep their src/ layout so the child's relative imports resolve exactly as in the repo.
 */
export async function writePluginHostTestFixture(root: string): Promise<string> {
  await Promise.all(
    [
      ['contexts/plugins/infrastructure/pluginHostEntry.ts', '.mjs'],
      ['contexts/plugins/infrastructure/PluginBackendHostClient.ts', '.js'],
      ['contexts/plugins/domain/pluginJsonValue.ts', '.js'],
      ['contexts/plugins/domain/pluginHostApi.ts', '.js'],
      ['shared/contracts/controlSurface/operations/pluginJsonValue.ts', '.js'],
    ].map(async ([source, extension]) => {
      const transformed = await transformWithEsbuild(
        await readFile(resolve('src', source), 'utf8'),
        source,
        { loader: 'ts', format: 'esm', target: 'node22' },
      )
      const path = join(root, 'src', source.replace(/\.ts$/, extension))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, transformed.code)
    }),
  )
  return join(root, 'src/contexts/plugins/infrastructure/pluginHostEntry.mjs')
}
