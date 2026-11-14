import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCanvasStateCheck } from '../../../scripts/check-canvas-state.mjs'
import { CANVAS_AREA_PREFIX } from '../../../scripts/lib/canvas-state-ratchet.mjs'
import { removeTemporaryRepositories, writeRepositoryFile } from './repoFixture'
import {
  commitAll,
  createClonedRepository,
  git,
  removeFixtureDirectories,
} from './ratchetRepoFixture'

const SCRIPT = resolve(import.meta.dirname, '../../../scripts/check-canvas-state.mjs')
const HOOK = `${CANVAS_AREA_PREFIX}hooks/useThing.ts`
const BASELINE = 'scripts/canvas-state-ratchet.json'

// A repository whose origin/main holds `source`, and no baseline yet.
function makeRepo(source: string) {
  return createClonedRepository({ [HOOK]: source, 'scripts/.gitkeep': '' }).repo
}

// The same, with the baseline for `source` committed and pushed, so it is the merge base's.
function makeBaselineRepo(source: string, accept: string[]) {
  const root = makeRepo(source)
  expect(run(root, true, accept).code).toBe(0)
  commitAll(root, 'baseline')
  git(root, 'push', '-q', 'origin', 'main')
  return root
}

const write = writeRepositoryFile

function run(root: string, updateRatchet = false, acceptRises: string[] = []) {
  let stderr = ''
  let stdout = ''
  const code = runCanvasStateCheck({
    repoRoot: root,
    updateRatchet,
    acceptRises,
    stderr: { write: (text: string) => (stderr += text) } as never,
    stdout: { write: (text: string) => (stdout += text) } as never,
  })
  return { code, stderr, stdout }
}

const readBaseline = (root: string) => JSON.parse(readFileSync(resolve(root, BASELINE), 'utf8'))

afterEach(() => {
  removeTemporaryRepositories()
  removeFixtureDirectories()
})

describe('check-canvas-state', () => {
  it('fails without a baseline, refuses an update that names no rule, then passes after --accept-rise', () => {
    const root = makeRepo('setNodes(a); setNodes(b)')
    expect(run(root).code).toBe(1)

    // A baseline absent at the merge base is a rise from 0 for every rule above 0.
    const refused = run(root, true)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('legacy-channel: total would rise from 0 to 2')
    expect(() => readBaseline(root)).toThrow()

    const accepted = run(root, true, ['legacy-channel'])
    expect(accepted.code).toBe(0)
    expect(accepted.stdout).toContain('## 📈 Ratchet rises')
    expect(readBaseline(root)['legacy-channel']).toEqual({ [HOOK]: 2 })
    expect(run(root).code).toBe(0)
  })

  it('fails when a count rises, and the update refuses to write it', () => {
    const root = makeBaselineRepo('setNodes(a)', ['legacy-channel'])
    write(root, HOOK, 'setNodes(a); setNodes(b)')
    const check = run(root)
    expect(check.code).toBe(1)
    expect(check.stderr).toContain('more than the baseline')

    const update = run(root, true)
    expect(update.code).toBe(1)
    expect(update.stderr).toContain('compared with merge base with origin/main (')
    expect(update.stderr).toContain('legacy-channel: total would rise from 1 to 2')
    expect(update.stderr).toContain(
      `- \`${BASELINE}\` \`legacy-channel\` 1 -> 2: <category>: <reason>`,
    )
    expect(readBaseline(root)['legacy-channel']).toEqual({ [HOOK]: 1 })
  })

  it('writes the rise when its rule is named, printing the section, and refuses an unused name', () => {
    const root = makeBaselineRepo('setNodes(a)', ['legacy-channel'])
    write(root, HOOK, 'setNodes(a); setNodes(b)')

    const unused = run(root, true, ['legacy-channel', 'ref-write'])
    expect(unused.code).toBe(1)
    expect(unused.stderr).toContain('--accept-rise ref-write: this rule neither rises nor retires')
    expect(readBaseline(root)['legacy-channel']).toEqual({ [HOOK]: 1 })

    const accepted = run(root, true, ['legacy-channel'])
    expect(accepted.code).toBe(0)
    expect(accepted.stdout).toContain(`\`${BASELINE}\` \`legacy-channel\` 1 -> 2`)
    expect(readBaseline(root)['legacy-channel']).toEqual({ [HOOK]: 2 })
  })

  it('refuses regenerating after the baseline was deleted in a commit, with one more finding', () => {
    const root = makeBaselineRepo('setNodes(a)', ['legacy-channel'])
    git(root, 'rm', '-q', BASELINE)
    commitAll(root, 'delete the baseline')
    write(root, HOOK, 'setNodes(a); setNodes(b)')

    const update = run(root, true)

    expect(update.code).toBe(1)
    expect(update.stderr).toContain('legacy-channel: total would rise from 1 to 2')
    expect(() => readBaseline(root)).toThrow()
  })

  it('prints every per-file rise when the update moves a count between files', () => {
    const root = makeBaselineRepo('setNodes(a); setNodes(b)', ['legacy-channel'])
    write(root, HOOK, 'setNodes(a)')
    write(root, 'src/app/moved.ts', 'setNodes(b)')
    const update = run(root, true)
    expect(update.code).toBe(0)
    expect(update.stdout).toContain('rise: src/app/moved.ts [legacy-channel] 0 -> 1')
    expect(update.stdout).not.toContain('Ratchet rises')

    write(root, 'src/app/more.ts', 'setNodes(c); setNodes(d)')
    const refused = run(root, true)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('rise: src/app/more.ts [legacy-channel] 0 -> 2')
    expect(refused.stderr).toContain('total would rise from 2 to 4')
  })

  it('fails when a count drops until the baseline is regenerated', () => {
    const root = makeBaselineRepo('setNodes(a); setNodes(b)', ['legacy-channel'])
    write(root, HOOK, 'setNodes(a)')
    const check = run(root)
    expect(check.code).toBe(1)
    expect(check.stderr).toContain('below the baseline')

    expect(run(root, true).code).toBe(0)
    expect(run(root).code).toBe(0)
  })

  it('counts a new workspace writer anywhere under src', () => {
    const root = makeBaselineRepo('', [])
    write(root, 'src/app/renderer/shell/hooks/useShell.ts', 'store.setWorkspaces(x)')
    const check = run(root)
    expect(check.code).toBe(1)
    expect(check.stderr).toContain('src/app/renderer/shell/hooks/useShell.ts [workspace-writer]')
  })

  it('does not count test files', () => {
    const root = makeBaselineRepo('', [])
    write(root, `${CANVAS_AREA_PREFIX}hooks/useThing.spec.ts`, 'setNodes(a)')
    expect(run(root).code).toBe(0)
  })

  it('rejects any command-line argument other than --update-ratchet', () => {
    const root = makeRepo('')
    for (const args of [['--baseline', '/tmp/other.json'], ['--config=x.json'], ['other.json']]) {
      const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('unsupported argument')
    }
  })

  it('takes --accept-rise only together with --update-ratchet', () => {
    const root = makeRepo('')
    const result = spawnSync(process.execPath, [SCRIPT, '--accept-rise', 'ref-write'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--accept-rise only applies together with --update-ratchet')
  })
})
