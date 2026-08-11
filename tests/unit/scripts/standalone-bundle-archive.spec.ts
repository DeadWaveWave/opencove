import { mkdtemp, mkdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  copyRuntimePreservingSymlinks,
  createTarArchive,
} from '../../../scripts/lib/standalone-bundle-archive.mjs'

import { afterEach, describe, expect, it } from 'vitest'

const describePosix = process.platform === 'win32' ? describe.skip : describe
const tempRoots: string[] = []

describePosix('standalone bundle archive', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map(async path => await rm(path, { recursive: true })))
  })

  it('keeps macOS framework symlinks relative and resolvable after extraction', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'opencove-standalone-archive-'))
    tempRoots.push(tempRoot)
    const sourceApp = join(tempRoot, 'source', 'OpenCove.app')
    const frameworkRoot = join(sourceApp, 'Contents', 'Frameworks', 'Electron Framework.framework')
    const versionRoot = join(frameworkRoot, 'Versions', 'A')
    await mkdir(versionRoot, { recursive: true })
    await writeFile(join(versionRoot, 'Electron Framework'), 'framework-binary')
    await symlink('A', join(frameworkRoot, 'Versions', 'Current'))
    await symlink('Versions/Current/Electron Framework', join(frameworkRoot, 'Electron Framework'))

    const archiveRoot = join(tempRoot, 'archive-root')
    const bundleName = 'opencove-server-macos-arm64'
    const copiedApp = join(archiveRoot, bundleName, 'runtime', basename(sourceApp))
    await mkdir(join(archiveRoot, bundleName, 'runtime'), { recursive: true })
    await copyRuntimePreservingSymlinks(sourceApp, copiedApp)

    const archivePath = join(tempRoot, `${bundleName}.tar.gz`)
    createTarArchive({ cwd: archiveRoot, outputPath: archivePath, sourceDirName: bundleName })

    const extractedRoot = join(tempRoot, 'extracted')
    await mkdir(extractedRoot)
    const extractResult = spawnSync('tar', ['-xzf', archivePath, '-C', extractedRoot], {
      encoding: 'utf8',
    })
    expect(extractResult.status, extractResult.stderr).toBe(0)

    const extractedFramework = join(
      extractedRoot,
      bundleName,
      'runtime',
      'OpenCove.app',
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
    )
    expect(await readlink(join(extractedFramework, 'Versions', 'Current'))).toBe('A')
    expect(await readlink(join(extractedFramework, 'Electron Framework'))).toBe(
      'Versions/Current/Electron Framework',
    )
    expect(await realpath(join(extractedFramework, 'Electron Framework'))).toBe(
      await realpath(join(extractedFramework, 'Versions', 'A', 'Electron Framework')),
    )
  })
})
