import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const workerSharedRoots = [
  'src/app/worker',
  'src/app/main/controlSurface/controlSurfaceHttpServer.ts',
  'src/app/main/controlSurface/registerControlSurfaceHandlers.ts',
  'src/app/main/controlSurface/handlers',
  'src/app/main/controlSurface/http',
  'src/app/main/controlSurface/ptyStream',
  'src/app/main/controlSurface/topology',
  'src/app/main/controlSurface/remote/controlSurfaceHttpClient.ts',
  'src/app/main/controlSurface/remote/resolveControlSurfaceConnectionInfo.ts',
]

async function collectTypeScriptFiles(pathname: string): Promise<string[]> {
  const entries = await readdir(pathname, { withFileTypes: true }).catch(() => null)
  if (!entries) {
    return pathname.endsWith('.ts') ? [pathname] : []
  }

  const files = await Promise.all(
    entries.map(async entry => {
      const childPath = join(pathname, entry.name)
      if (entry.isDirectory()) {
        return await collectTypeScriptFiles(childPath)
      }

      return entry.isFile() && entry.name.endsWith('.ts') ? [childPath] : []
    }),
  )

  return files.flat()
}

describe('worker control surface import boundary', () => {
  it('keeps worker-shared modules free of Electron main-process imports', async () => {
    const files = (
      await Promise.all(
        workerSharedRoots.map(async root => {
          return await collectTypeScriptFiles(resolve(process.cwd(), root))
        }),
      )
    ).flat()

    const electronImportPattern =
      /\bfrom\s+['"]electron['"]|\bimport\s+['"]electron['"]|\brequire\(\s*['"]electron['"]\s*\)/

    const checkedFiles = await Promise.all(
      files.map(async filePath => {
        return {
          filePath,
          source: await readFile(filePath, 'utf8'),
        }
      }),
    )

    const offenders = checkedFiles.flatMap(({ filePath, source }) => {
      if (electronImportPattern.test(source)) {
        return [filePath.replace(`${process.cwd()}/`, '')]
      }

      return []
    })

    expect(offenders).toEqual([])
  })
})
