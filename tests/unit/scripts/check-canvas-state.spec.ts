import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCanvasStateCheck } from '../../../scripts/check-canvas-state.mjs'
import { CANVAS_AREA_PREFIX } from '../../../scripts/lib/canvas-state-ratchet.mjs'

const SCRIPT = resolve(import.meta.dirname, '../../../scripts/check-canvas-state.mjs')
const HOOK = `${CANVAS_AREA_PREFIX}hooks/useThing.ts`
const BASELINE = 'scripts/canvas-state-ratchet.json'
const roots: string[] = []

function makeRepo(source: string) {
  const root = mkdtempSync(resolve(tmpdir(), 'canvas-state-'))
  roots.push(root)
  mkdirSync(resolve(root, 'scripts'))
  write(root, HOOK, source)
  return root
}

function write(root: string, path: string, content: string) {
  const absolute = resolve(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function run(root: string, updateRatchet = false) {
  let stderr = ''
  let stdout = ''
  const code = runCanvasStateCheck({
    repoRoot: root,
    updateRatchet,
    stderr: { write: (text: string) => (stderr += text) } as never,
    stdout: { write: (text: string) => (stdout += text) } as never,
  })
  return { code, stderr, stdout }
}

const readBaseline = (root: string) => JSON.parse(readFileSync(resolve(root, BASELINE), 'utf8'))

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('check-canvas-state', () => {
  it('fails without a baseline, writes one on update, then passes', () => {
    const root = makeRepo('setNodes(a); setNodes(b)')
    expect(run(root).code).toBe(1)
    expect(run(root, true).code).toBe(0)
    expect(readBaseline(root)['legacy-channel']).toEqual({ [HOOK]: 2 })
    expect(run(root).code).toBe(0)
  })

  it('fails when a count rises, and the update refuses to write it', () => {
    const root = makeRepo('setNodes(a)')
    run(root, true)
    write(root, HOOK, 'setNodes(a); setNodes(b)')
    const check = run(root)
    expect(check.code).toBe(1)
    expect(check.stderr).toContain('more than the baseline')

    const update = run(root, true)
    expect(update.code).toBe(1)
    expect(update.stderr).toContain('legacy-channel: total would rise from 1 to 2')
    expect(readBaseline(root)['legacy-channel']).toEqual({ [HOOK]: 1 })
  })

  it('prints every per-file rise when the update moves a count between files', () => {
    const root = makeRepo('setNodes(a); setNodes(b)')
    run(root, true)
    write(root, HOOK, 'setNodes(a)')
    write(root, 'src/app/moved.ts', 'setNodes(b)')
    const update = run(root, true)
    expect(update.code).toBe(0)
    expect(update.stderr).toContain('rise: src/app/moved.ts [legacy-channel] 0 -> 1')

    write(root, 'src/app/more.ts', 'setNodes(c); setNodes(d)')
    const refused = run(root, true)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('rise: src/app/more.ts [legacy-channel] 0 -> 2')
    expect(refused.stderr).toContain('total would rise from 2 to 4')
  })

  it('fails when a count drops until the baseline is regenerated', () => {
    const root = makeRepo('setNodes(a); setNodes(b)')
    run(root, true)
    write(root, HOOK, 'setNodes(a)')
    const check = run(root)
    expect(check.code).toBe(1)
    expect(check.stderr).toContain('below the baseline')

    expect(run(root, true).code).toBe(0)
    expect(run(root).code).toBe(0)
  })

  it('counts a new workspace writer anywhere under src', () => {
    const root = makeRepo('')
    run(root, true)
    write(root, 'src/app/renderer/shell/hooks/useShell.ts', 'store.setWorkspaces(x)')
    const check = run(root)
    expect(check.code).toBe(1)
    expect(check.stderr).toContain('src/app/renderer/shell/hooks/useShell.ts [workspace-writer]')
  })

  it('does not count test files', () => {
    const root = makeRepo('')
    run(root, true)
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
})
