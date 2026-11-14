import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runUiStyleCheck } from '../../../scripts/check-ui-styles.mjs'
import {
  countMarkupLiterals,
  serializeMarkupRatchet,
} from '../../../scripts/lib/ui-markup-ratchet.mjs'
import { removeTemporaryRepositories, writeRepositoryFile } from './repoFixture'
import {
  commitAll,
  createClonedRepository,
  git,
  removeFixtureDirectories,
} from './ratchetRepoFixture'
import {
  compareScaleRatchet,
  countScaleLiterals,
  serializeScaleRatchet,
} from '../../../scripts/lib/ui-style-ratchet.mjs'

const file = (path: string, content: string) => ({ path, content })

describe('UI scale ratchet', () => {
  it('counts hard-coded scale values per rule and file', () => {
    const counts = countScaleLiterals([
      file(
        'src/app/renderer/styles/card.css',
        `
        .card {
          font-size: calc(12px * var(--cove-ui-font-scale));
          border-radius: 8px;
          border-top-left-radius: 4px;
          z-index: 140;
          padding: 8px 12px;
          margin-inline: -6px;
          row-gap: 10px;
        }
        .title { font-size: 0.9em; }
        `,
      ),
    ])

    expect(counts).toEqual({
      'font-size': { 'src/app/renderer/styles/card.css': 2 },
      radius: { 'src/app/renderer/styles/card.css': 2 },
      spacing: { 'src/app/renderer/styles/card.css': 3 },
      'z-index': { 'src/app/renderer/styles/card.css': 1 },
    })
  })

  it('ignores tokens, zeros, local stacking, sub-grid nudges, comments and custom properties', () => {
    const counts = countScaleLiterals([
      file(
        'src/app/renderer/styles/card.css',
        `
        /* font-size: 14px; z-index: 900; padding: 16px; */
        :root { --cove-control-gap: 6px; --cove-radius-sm: 8px; }
        .card:hover {
          font-size: var(--cove-font-size-body);
          border-radius: var(--cove-radius-sm);
          border-radius: 50%;
          z-index: 2;
          z-index: var(--cove-z-popover);
          padding: 0;
          margin: 0 auto;
          gap: var(--cove-spacing-2);
          padding-top: 2px;
        }
        `,
      ),
    ])

    expect(counts).toEqual({ 'font-size': {}, radius: {}, spacing: {}, 'z-index': {} })
  })

  it('reports growth, unlocked improvements and stale baseline entries', () => {
    const issues = compareScaleRatchet(
      {
        'font-size': { 'a.css': 3 },
        radius: { 'b.css': 1 },
        spacing: { 'a.css': 5 },
        'z-index': {},
      },
      {
        'font-size': { 'a.css': 2 },
        radius: { 'b.css': 4 },
        spacing: { 'a.css': 5 },
        'z-index': { 'removed.css': 1 },
      },
    )

    expect(issues).toEqual([
      expect.objectContaining({ file: 'a.css', rule: 'font-size', baseline: 2, current: 3 }),
      expect.objectContaining({ file: 'b.css', rule: 'radius', baseline: 4, current: 1 }),
      expect.objectContaining({ file: 'removed.css', rule: 'z-index', baseline: 1, current: 0 }),
    ])
    expect(issues[0].message).toContain('--cove-font-size-*')
    expect(issues[1].message).toContain('pnpm ui:style-ratchet')
  })

  it('accepts counts that match the baseline', () => {
    const counts = { 'font-size': { 'a.css': 1 }, radius: {}, spacing: {}, 'z-index': {} }
    expect(compareScaleRatchet(counts, JSON.parse(serializeScaleRatchet(counts)))).toEqual([])
  })

  it('serializes a stable rule-major baseline', () => {
    const text = serializeScaleRatchet({
      spacing: { 'b.css': 2, 'a.css': 1 },
      'font-size': { 'c.css': 4 },
      'z-index': {},
      radius: {},
    })

    expect(text).toBe(
      [
        '{',
        '  "font-size": {',
        '    "c.css": 4',
        '  },',
        '  "radius": {},',
        '  "spacing": {',
        '    "a.css": 1,',
        '    "b.css": 2',
        '  },',
        '  "z-index": {}',
        '}',
        '',
      ].join('\n'),
    )
  })
})

describe('UI ratchet update guard', () => {
  afterEach(() => {
    removeTemporaryRepositories()
    removeFixtureDirectories()
  })

  const CSS = 'src/app/renderer/styles/a.css'
  const TSX = 'src/app/renderer/Foo.tsx'
  const SCALE_FILE = 'scripts/ui-style-ratchet.json'
  const MARKUP_FILE = 'scripts/ui-markup-ratchet.json'
  const css = '.a { padding: 8px; margin: 12px; }\n'
  const tsx = 'export const Foo = () => <button type="button">x</button>\n'

  function createRepository() {
    const sources = { [CSS]: css, [TSX]: tsx }
    const scale = serializeScaleRatchet(countScaleLiterals([file(CSS, css)]))
    const markup = serializeMarkupRatchet(countMarkupLiterals([file(TSX, tsx)]))
    return createClonedRepository({ ...sources, [SCALE_FILE]: scale, [MARKUP_FILE]: markup })
  }

  function update(repo: string, acceptRises: string[] = []) {
    let out = ''
    let err = ''
    const code = runUiStyleCheck({
      repoRoot: repo,
      updateRatchet: true,
      acceptRises,
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: (text: string) => (err += text) },
    })
    return { code, out, err }
  }

  const read = (repo: string, path: string) => readFileSync(join(repo, path), 'utf8')

  it('leaves the baselines byte for byte unchanged when nothing moved', () => {
    const { repo } = createRepository()
    const before = [read(repo, SCALE_FILE), read(repo, MARKUP_FILE)]

    expect(update(repo)).toMatchObject({ code: 0, err: '' })
    expect([read(repo, SCALE_FILE), read(repo, MARKUP_FILE)]).toEqual(before)
  })

  it('refuses a scale rise instead of recording it, as `pnpm ui:style-ratchet` used to', () => {
    const { repo, first } = createRepository()
    const before = read(repo, SCALE_FILE)
    writeRepositoryFile(repo, CSS, `${css}.b { padding: 12px; }\n`)

    const { code, err } = update(repo)

    expect(code).toBe(1)
    expect(err).toContain(`compared with merge base with origin/main (${first.slice(0, 8)})`)
    expect(err).toContain('spacing: total would rise from 2 to 3.')
    expect(err).toContain(`- \`${SCALE_FILE}\` \`spacing\` 2 -> 3: <category>: <reason>`)
    expect(read(repo, SCALE_FILE)).toBe(before)
  })

  it('refuses a markup rise and writes neither baseline', () => {
    const { repo } = createRepository()
    const before = [read(repo, SCALE_FILE), read(repo, MARKUP_FILE)]
    writeRepositoryFile(repo, CSS, `${css}.b { padding: 12px; }\n`)
    writeRepositoryFile(
      repo,
      TSX,
      `${tsx}export const Bar = () => <button type="button">y</button>\n`,
    )

    const { code, err } = update(repo, ['spacing'])

    expect(code).toBe(1)
    expect(err).toContain('native-button: total would rise from 1 to 2.')
    expect([read(repo, SCALE_FILE), read(repo, MARKUP_FILE)]).toEqual(before)
  })

  it('writes both baselines when every risen rule is named, and prints the section', () => {
    const { repo } = createRepository()
    writeRepositoryFile(repo, CSS, `${css}.b { padding: 12px; }\n`)
    writeRepositoryFile(
      repo,
      TSX,
      `${tsx}export const Bar = () => <button type="button">y</button>\n`,
    )

    const { code, out } = update(repo, ['spacing', 'native-button'])

    expect(code).toBe(0)
    expect(JSON.parse(read(repo, SCALE_FILE)).spacing).toEqual({ [CSS]: 3 })
    expect(JSON.parse(read(repo, MARKUP_FILE))['native-button']).toEqual({ [TSX]: 2 })
    expect(out).toContain('## 📈 Ratchet rises')
    expect(out).toContain(`\`${SCALE_FILE}\` \`spacing\` 2 -> 3`)
    expect(out).toContain(`\`${MARKUP_FILE}\` \`native-button\` 1 -> 2`)
  })

  it('refuses a flag for a rule that does not rise, and accepts a drop', () => {
    const { repo } = createRepository()

    const unused = update(repo, ['radius'])
    expect(unused.code).toBe(1)
    expect(unused.err).toContain('--accept-rise radius: this rule neither rises nor retires')

    writeRepositoryFile(repo, CSS, '.a { padding: 8px; }\n')
    expect(update(repo)).toMatchObject({ code: 0 })
    expect(JSON.parse(read(repo, SCALE_FILE)).spacing).toEqual({ [CSS]: 1 })
  })

  it('regenerates deleted baselines with unchanged totals, which is no rise', () => {
    const { repo } = createRepository()
    const before = [read(repo, SCALE_FILE), read(repo, MARKUP_FILE)]
    git(repo, 'rm', '-q', SCALE_FILE, MARKUP_FILE)
    commitAll(repo, 'delete the baselines')
    mkdirSync(join(repo, 'scripts'), { recursive: true })

    expect(update(repo)).toMatchObject({ code: 0, err: '' })
    expect([read(repo, SCALE_FILE), read(repo, MARKUP_FILE)]).toEqual(before)
  })

  it('refuses regenerating after the baselines were deleted in a commit, and a new finding on top', () => {
    const { repo } = createRepository()
    git(repo, 'rm', '-q', SCALE_FILE, MARKUP_FILE)
    commitAll(repo, 'delete the baselines')
    writeRepositoryFile(repo, CSS, `${css}.b { padding: 12px; }\n`)

    const { code, err } = update(repo)

    expect(code).toBe(1)
    expect(err).toContain('spacing: total would rise from 2 to 3.')
    expect(err).not.toContain('native-button')
    expect(() => read(repo, SCALE_FILE)).toThrow()
  })
})
