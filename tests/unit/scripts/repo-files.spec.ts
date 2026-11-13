import { afterEach, describe, expect, it } from 'vitest'
import {
  createGitRepository,
  removeTemporaryRepositories,
  runGit,
  writeRepositoryFile,
} from './repoFixture'

afterEach(removeTemporaryRepositories)

async function list(cwd: string): Promise<string[]> {
  const module = await import('../../../scripts/lib/repo-files.mjs')
  return module.listRepositoryFiles(cwd).sort()
}

describe('listRepositoryFiles', () => {
  it('lists tracked and untracked files, but not ignored ones, whatever is staged', async () => {
    const root = createGitRepository()
    writeRepositoryFile(root, '.gitignore', 'ignored.ts\n')
    writeRepositoryFile(root, 'tracked.ts', 'a\n')
    writeRepositoryFile(root, 'ignored.ts', 'a\n')
    runGit(['add', '.gitignore', 'tracked.ts'], root)
    writeRepositoryFile(root, 'src/untracked.ts', 'a\n')

    await expect(list(root)).resolves.toEqual(['.gitignore', 'src/untracked.ts', 'tracked.ts'])
  })

  it('excludes node_modules, dist and out by prefix, never by substring', async () => {
    const root = createGitRepository()
    writeRepositoryFile(root, 'node_modules/pkg/index.js', 'a\n')
    writeRepositoryFile(root, 'dist/bundle.js', 'a\n')
    writeRepositoryFile(root, 'out/main.js', 'a\n')
    writeRepositoryFile(root, 'src/layout/panel.ts', 'a\n')
    writeRepositoryFile(root, 'src/out/panel.ts', 'a\n')
    writeRepositoryFile(root, 'src/dist/panel.ts', 'a\n')

    await expect(list(root)).resolves.toEqual([
      'src/dist/panel.ts',
      'src/layout/panel.ts',
      'src/out/panel.ts',
    ])
  })

  it('throws outside a git repository instead of returning an empty list', async () => {
    const module = await import('../../../scripts/lib/repo-files.mjs')
    expect(() => module.listRepositoryFiles('/')).toThrow(/Failed to list repository files/)
  })
})
