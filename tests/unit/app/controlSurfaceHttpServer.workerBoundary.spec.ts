import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

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
  'src/shared/runtime',
]

const workerEntry = 'src/app/worker/index.ts'
const workerAllowedRoots = [
  'src/app/worker',
  'src/app/main/controlSurface',
  'src/app/main/diagnostics/agentLaunchRuntimeDiagnostics.ts',
  'src/app/main/ipc/normalize.ts',
  'src/app/main/worker/workerConnectionHealth.ts',
  'src/platform/os',
  'src/platform/process',
  'src/platform/persistence',
  'src/platform/terminal',
  'src/contexts',
  'src/shared',
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

function normalizePath(pathname: string): string {
  return pathname.replaceAll('\\', '/')
}

function isInAllowedWorkerSource(filePath: string): boolean {
  const relativePath = normalizePath(filePath.replace(`${process.cwd()}/`, ''))
  return workerAllowedRoots.some(root => {
    const normalizedRoot = normalizePath(root)
    return relativePath === normalizedRoot || relativePath.startsWith(`${normalizedRoot}/`)
  })
}

function readImportSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function resolveRelativeTypeScriptImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null
  }

  const base = resolve(dirname(fromFile), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    resolve(base, 'index.ts'),
  ]

  return (
    candidates.find(candidate => {
      try {
        return existsSync(candidate) && statSync(candidate).isFile()
      } catch {
        return false
      }
    }) ?? null
  )
}

async function collectRuntimeImportGraph(entryFile: string): Promise<{
  files: string[]
  boundaryOffenders: string[]
}> {
  const visited = new Set<string>()
  const boundaryOffenders = new Set<string>()

  const visit = async (filePath: string): Promise<void> => {
    const normalizedFilePath = resolve(filePath)
    if (visited.has(normalizedFilePath)) {
      return
    }

    if (!isInAllowedWorkerSource(normalizedFilePath)) {
      return
    }

    visited.add(normalizedFilePath)
    const source = await readFile(normalizedFilePath, 'utf8')
    const nextFiles: string[] = []
    for (const specifier of readImportSpecifiers(source)) {
      const nextFile = resolveRelativeTypeScriptImport(normalizedFilePath, specifier)
      if (nextFile) {
        if (!isInAllowedWorkerSource(nextFile)) {
          boundaryOffenders.add(nextFile)
          continue
        }

        nextFiles.push(nextFile)
      }
    }

    await Promise.all(nextFiles.map(async nextFile => await visit(nextFile)))
  }

  await visit(entryFile)
  return {
    files: [...visited].sort(),
    boundaryOffenders: [...boundaryOffenders].sort(),
  }
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

  it('keeps the Worker runtime import graph free of Electron version readers', async () => {
    const graph = await collectRuntimeImportGraph(resolve(process.cwd(), workerEntry))
    expect(
      graph.boundaryOffenders.map(filePath => filePath.replace(`${process.cwd()}/`, '')),
    ).toEqual([])
    const checkedFiles = await Promise.all(
      graph.files.map(async filePath => {
        return {
          filePath,
          source: await readFile(filePath, 'utf8'),
        }
      }),
    )

    const forbiddenImportPattern =
      /\bfrom\s+['"]electron['"]|\bimport\s+['"]electron['"]|\brequire\(\s*['"]electron['"]\s*\)|runtimeAppVersion/
    const offenders = checkedFiles.flatMap(({ filePath, source }) => {
      if (forbiddenImportPattern.test(source)) {
        return [filePath.replace(`${process.cwd()}/`, '')]
      }

      return []
    })

    expect(offenders).toEqual([])
  })
})
