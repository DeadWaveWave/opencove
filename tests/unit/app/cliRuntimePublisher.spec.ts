// @vitest-environment node
import { mkdtemp, mkdir, link, copyFile, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publishRuntime } from '../../../src/app/cli/publishRuntime.mjs'

describe('immutable runtime publication', () => {
  it('reuses verified content and repairs corruption without overwriting the active directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-publisher-'))
    const identity = {
      build: { buildId: 'a'.repeat(64) },
      platform: process.platform,
      arch: process.arch,
      engine: 'node',
    }
    const stage = async (name: string) => {
      const directory = join(root, name)
      const node = join(
        directory,
        process.platform === 'win32' ? 'runtime/node/node.exe' : 'runtime/node/bin/node',
      )
      await mkdir(join(node, '..'), { recursive: true })
      await link(process.execPath, node).catch(() => copyFile(process.execPath, node))
      await mkdir(join(directory, 'app/out/main'), { recursive: true })
      await writeFile(
        join(directory, 'app/out/main/managedRuntime.js'),
        `process.stdout.write(${JSON.stringify(JSON.stringify(identity))})`,
      )
      await writeFile(join(directory, 'app/out/main/lazy.js'), 'original lazy module')
      return directory
    }
    try {
      const target = join(root, 'published')
      expect(await publishRuntime(await stage('first'), target, 'a'.repeat(64))).toBe(target)
      expect(await publishRuntime(await stage('second'), target, 'a'.repeat(64))).toBe(target)
      await writeFile(join(target, 'app/out/main/lazy.js'), 'corrupted lazy module')
      const repaired = await publishRuntime(await stage('third'), target, 'a'.repeat(64))
      expect(repaired).not.toBe(target)
      expect(await readFile(join(target, 'app/out/main/lazy.js'), 'utf8')).toBe(
        'corrupted lazy module',
      )
      expect(await readFile(join(repaired, 'app/out/main/lazy.js'), 'utf8')).toBe(
        'original lazy module',
      )
      await expect(access(target)).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
