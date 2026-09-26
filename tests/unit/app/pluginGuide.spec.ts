import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createPluginGuideResult,
  resolvePluginGuideDirectory,
} from '../../../src/app/cli/pluginGuide.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('plugin guide paths', () => {
  it('resolves the source checkout guide and all built-in documents', () => {
    const result = createPluginGuideResult()

    expect(result.directory).toBe(join(repositoryRoot, 'docs', 'plugins'))
    expect(existsSync(result.readme)).toBe(true)
    expect(result.plugins).toEqual([
      {
        id: 'git-board',
        manifestVersion: '0.1.0',
        document: join(repositoryRoot, 'docs', 'plugins', 'GIT_BOARD_MVP.md'),
      },
    ])
    expect(existsSync(result.plugins[0].document)).toBe(true)
  })

  it('resolves docs beside the packaged app.asar CLI', () => {
    const scriptPath =
      '/Applications/OpenCove.app/Contents/Resources/app.asar/src/app/cli/opencove.mjs'

    expect(resolvePluginGuideDirectory(scriptPath)).toBe(
      '/Applications/OpenCove.app/Contents/Resources/app.asar/docs/plugins',
    )
  })

  it('includes plugin docs in the electron-builder app files', () => {
    const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))

    expect(packageJson.build.files).toContain('docs/plugins{,/**/*}')
  })
})
