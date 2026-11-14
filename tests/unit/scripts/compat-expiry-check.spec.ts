import { afterEach, describe, expect, it } from 'vitest'
import { scanCompatSource } from '../../../scripts/lib/compatMarkers.mjs'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  createGitRepository,
  removeTemporaryRepositories,
  runGit,
  runScript,
  writeRepositoryFile,
} from './repoFixture'

afterEach(removeTemporaryRepositories)

// Built at runtime so this file does not trip the naming check itself.
const c = 'cove'
const STORAGE_PREFIX = `${c}:m0:`

const REGISTRY = 'src/shared/compat/compatRegistry.json'
const SCRIPT = 'check-compat-expiry.mjs'

type Entry = Record<string, unknown>

const entry = (overrides: Entry = {}): Entry => ({
  kind: 'wire',
  expires: { until: '0.7.0' },
  reason: 'Keeps the old wire shape for older callers.',
  decidedIn: '#642',
  ...overrides,
})

interface FixtureOptions {
  version?: string
  floor?: string
  reviewBy?: string
  entries?: Record<string, Entry>
  files?: Record<string, string>
  baseline?: unknown
}

// A repository whose registry has one valid entry `old-wire` that one marker uses.
function createFixture(options: FixtureOptions = {}): string {
  const root = createGitRepository()
  writeRepositoryFile(
    root,
    'package.json',
    JSON.stringify({ name: 'fixture', version: options.version ?? '0.5.0' }),
  )
  writeRepositoryFile(
    root,
    REGISTRY,
    JSON.stringify({
      upgradeSupport: {
        floor: options.floor ?? '0.1.0',
        reviewBy: options.reviewBy ?? '0.7.0',
        decidedIn: '#642',
      },
      entries: options.entries ?? { 'old-wire': entry() },
    }),
  )
  const files = options.files ?? {
    'src/feature.ts': '// @compat old-wire\nexport const oldShape = 1\n',
  }
  for (const [path, content] of Object.entries(files)) {
    writeRepositoryFile(root, path, content)
  }
  if (options.baseline !== undefined) {
    writeRepositoryFile(root, 'scripts/compat-ratchet.json', JSON.stringify(options.baseline))
  }
  return root
}

const run = (root: string, ...args: string[]) => runScript(SCRIPT, root, args)

describe('compat expiry check: registry rules', () => {
  it('accepts a marked entry that has not expired and reports what it scanned', () => {
    const result = run(createFixture())
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('scanned 1 files at version 0.5.0, 1 entries')
  })

  it('(a) fails once package.json reaches `until`, naming the entry', () => {
    const result = run(createFixture({ version: '0.7.0' }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[expired] (old-wire)')
    expect(result.stderr).toContain('expires at 0.7.0 and the version is 0.7.0')
  })

  it('(a) evaluates a future version with --at and leaves the current verdict alone', () => {
    const root = createFixture()
    expect(run(root, '--at', '0.6.0').status).toBe(0)
    const result = run(root, '--at', '0.7.0')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('(old-wire)')
    expect(run(root).status).toBe(0)
  })

  it('(a) expires `dataBefore` entries only when the floor reaches them', () => {
    const entries = { 'old-data': entry({ kind: 'user-data', expires: { dataBefore: '0.3.0' } }) }
    const files = { 'src/migrate.ts': '// @compat-file old-data\nexport const migrate = 1\n' }
    expect(run(createFixture({ entries, files, version: '0.9.0', reviewBy: '1.0.0' })).status).toBe(
      0,
    )
    const result = run(createFixture({ entries, files, floor: '0.3.0' }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[expired] (old-data)')
    expect(result.stderr).toContain('upgrade floor is 0.3.0')
  })

  it('(a) fails when the floor decision itself passed `reviewBy`', () => {
    const result = run(createFixture({ reviewBy: '0.5.0', floor: '0.1.0' }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('upgradeSupport.reviewBy 0.5.0 has been reached')
  })

  it('(b) fails on a marker that names an unknown id, with file, line and id', () => {
    const root = createFixture({
      files: {
        'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
        'src/other.ts': 'export const x = 1\n// @compat missing-id\nexport const b = 2\n',
      },
    })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/other.ts:2 [unknown-id] (missing-id)')
  })

  it('(b) fails on a typed `compat:` anchor that names an unknown id', () => {
    const root = createFixture({
      files: {
        'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
        'src/op.ts': "export const op = defineOperation({\n  compat: 'missing-id',\n})\n",
      },
    })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/op.ts:2 [unknown-id] (missing-id)')
  })

  it('(c) fails on a registry entry that no marker or typed anchor uses', () => {
    const root = createFixture({
      entries: { 'old-wire': entry(), 'unused-entry': entry() },
    })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`${REGISTRY} [stale-entry] (unused-entry)`)
  })

  it('(c) counts a typed anchor as a use', () => {
    const root = createFixture({
      files: { 'src/op.ts': "export const op = defineOperation({\n  compat: 'old-wire',\n})\n" },
    })
    expect(run(root).status).toBe(0)
  })

  it.each([
    ['missing reason', { reason: '' }, '`reason`'],
    ['blank reason', { reason: '   ' }, '`reason`'],
    ['missing decidedIn', { decidedIn: undefined }, '`decidedIn`'],
    ['unknown kind', { kind: 'misc' }, 'kind "misc"'],
    ['"never" expiry', { expires: { until: 'never' } }, 'must be a version'],
    ['malformed version', { expires: { until: '0.7' } }, 'must be a version'],
    ['both expiries', { expires: { until: '0.7.0', dataBefore: '0.3.0' } }, 'exactly one'],
    ['no expiry', { expires: {} }, 'exactly one'],
  ])('(d) rejects an entry with %s', (_name, overrides, message) => {
    const result = run(createFixture({ entries: { 'old-wire': entry(overrides) } }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('(old-wire)')
    expect(result.stderr).toContain(message)
  })

  it('(d) rejects an invalid floor', () => {
    const result = run(createFixture({ floor: 'old' }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('upgradeSupport.floor must be a version')
  })

  it('(e) requires @compat-file on every file in src/shared/featureFlags/', () => {
    const root = createFixture({
      files: {
        'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
        'src/shared/featureFlags/flags.ts': 'export const FLAG = false\n',
      },
    })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/shared/featureFlags/flags.ts:1 [feature-flag-unmarked]')

    writeRepositoryFile(
      root,
      'src/shared/featureFlags/flags.ts',
      '// @compat-file old-wire\nexport const FLAG = false\n',
    )
    expect(run(root).status).toBe(0)
  })

  it('(f) requires a marker in every oracle file', () => {
    const root = createFixture({
      files: {
        'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
        'tests/support/controlSurfaceLegacyOracles/node.ts': 'export const oracle = 1\n',
      },
    })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'tests/support/controlSurfaceLegacyOracles/node.ts:1 [oracle-unmarked]',
    )

    writeRepositoryFile(
      root,
      'tests/support/controlSurfaceLegacyOracles/node.ts',
      '// @compat-file old-wire\nexport const oracle = 1\n',
    )
    expect(run(root).status).toBe(0)
  })

  it('ignores spec files, declaration files and other tests', () => {
    const root = createFixture({
      files: {
        'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
        'src/feature.spec.ts': `// @compat nope\nconst legacy = '${STORAGE_PREFIX}x'\n`,
        'tests/unit/legacy.ts': `export const legacy = '${STORAGE_PREFIX}x'\n`,
      },
    })
    expect(run(root).status).toBe(0)
  })

  it('fails when it scanned zero files', () => {
    const root = createFixture({ files: { 'README.md': 'text\n' } })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('scanned 0 files')
  })

  it('rejects a malformed --at', () => {
    const result = run(createFixture(), '--at', 'soon')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--at needs a version')
  })
})

describe('compat expiry check: unmarked signals ratchet', () => {
  const signalFile = (body: string) => ({
    'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
    'src/signal.ts': body,
  })

  it('(g) fails on unmarked signals above the baseline and names file and rule', () => {
    const root = createFixture({ files: signalFile('export const legacyShape = 1\n') })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/signal.ts [keyword]')
    expect(result.stderr).toContain('1 unmarked keyword signal(s), baseline 0')
  })

  it.each([
    ['legacy identifier', 'export const LegacyMode = 1\n', 'keyword'],
    ['deprecated tag', '/** @deprecated use b */\nexport const a = 1\n', 'keyword'],
    ['compat word', '// kept for Compat reasons\nexport const a = 1\n', 'keyword'],
    ['compatibility word', 'export const compatibility = 1\n', 'keyword'],
    ['backwards compatibility', '// for backwards compatibility\nexport const a = 1\n', 'keyword'],
    [
      'legacy storage prefix literal',
      `export const key = '${STORAGE_PREFIX}state'\n`,
      'storage-prefix',
    ],
    ['clientFeatures read', 'export const on = ctx.clientFeatures?.flag\n', 'client-features'],
  ])('(g) counts %s as a signal', (_name, body, rule) => {
    const result = run(createFixture({ files: signalFile(body) }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`src/signal.ts [${rule}]`)
  })

  it('does not count ordinary words, imports or the opencove:m0: prefix', () => {
    const body = [
      "import { legacyThing } from './x'",
      '// a compatible, backward direction',
      "export const key = 'opencove:m0:state'",
      '',
    ].join('\n')
    expect(run(createFixture({ files: signalFile(body) })).status).toBe(0)
  })

  it('accepts signals up to the baseline', () => {
    const root = createFixture({
      files: signalFile('export const legacyA = 1\nexport const legacyB = 2\n'),
      baseline: { keyword: { 'src/signal.ts': 2 } },
    })
    expect(run(root).status).toBe(0)
  })

  it('fails when a count dropped until the baseline is regenerated', () => {
    const root = createFixture({
      files: signalFile('export const legacyA = 1\n'),
      baseline: { keyword: { 'src/signal.ts': 3 } },
    })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('1 unmarked keyword signal(s), baseline 3')
    expect(result.stderr).toContain('--update-ratchet')

    expect(run(root, '--update-ratchet').status).toBe(0)
    expect(run(root).status).toBe(0)
  })

  it('a marker removes the signals it covers from the count', () => {
    const body = '// @compat old-wire\nexport function legacyShape() {\n  return 1\n}\n'
    expect(run(createFixture({ files: signalFile(body) })).status).toBe(0)
  })

  it('a marker does not hide signals outside the node it covers', () => {
    const body = [
      '// @compat old-wire',
      'export function legacyShape() {',
      '  return 1',
      '}',
      'export const legacyOther = 2',
      '',
    ].join('\n')
    const result = run(createFixture({ files: signalFile(body) }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('1 unmarked keyword signal(s), baseline 0')
  })

  it('a trailing "legacy" comment no longer lets a signal through', () => {
    const result = run(
      createFixture({
        files: signalFile(`export const key = '${STORAGE_PREFIX}state' // legacy\n`),
      }),
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/signal.ts [storage-prefix]')
  })
})

describe('compat expiry check: --report', () => {
  it('lists entries that expire at the next minor and file-level markers without failing', () => {
    const root = createFixture({
      version: '0.6.0',
      entries: {
        'old-wire': entry(),
        'later-wire': entry({ expires: { until: '0.9.0' } }),
      },
      files: {
        'src/a.ts': '// @compat-file old-wire\nexport const a = 1\n',
        'src/b.ts': '// @compat later-wire\nexport const b = 1\n',
      },
    })
    const result = run(root, '--report')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('next minor release is 0.7.0')
    expect(result.stdout).toContain('- old-wire (until 0.7.0)')
    expect(result.stdout).not.toContain('later-wire (until')
    expect(result.stdout).toContain('- src/a.ts (old-wire)')
  })
})

describe('compat expiry check: scope and limits', () => {
  it('requires a file marker on every Control Surface parity spec', () => {
    const root = createFixture({
      files: {
        'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
        'tests/unit/contexts/controlSurface.sampleParity.spec.ts': 'export const parity = 1\n',
      },
    })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'tests/unit/contexts/controlSurface.sampleParity.spec.ts:1 [parity-spec-unmarked]',
    )

    writeRepositoryFile(
      root,
      'tests/unit/contexts/controlSurface.sampleParity.spec.ts',
      '// @compat-file old-wire\nexport const parity = 1\n',
    )
    expect(run(root).status).toBe(0)
  })

  it('keeps an entry alive only while a parity spec or oracle still uses it', () => {
    const root = createFixture({
      files: {
        'tests/unit/contexts/controlSurface.sampleParity.spec.ts':
          '// @compat-file old-wire\nexport const parity = 1\n',
      },
    })
    expect(run(root).status).toBe(0)
    rmSync(join(root, 'tests/unit/contexts/controlSurface.sampleParity.spec.ts'))
    writeRepositoryFile(root, 'src/other.ts', 'export const a = 1\n')
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[stale-entry] (old-wire)')
  })

  it('rejects an `until` more than three minor versions ahead of package.json', () => {
    const far = { 'old-wire': entry({ expires: { until: '0.9.0' } }) }
    const result = run(createFixture({ entries: far }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[invalid-expiry] (old-wire)')
    expect(result.stderr).toContain('latest allowed 0.8.0')

    const edge = { 'old-wire': entry({ expires: { until: '0.8.0' } }) }
    expect(run(createFixture({ entries: edge })).status).toBe(0)
  })

  it.each(['wire', 'peer-version', 'third-party', 'kill-switch'])(
    'rejects `dataBefore` on a %s entry, so it cannot dodge the horizon',
    kind => {
      const entries = { 'old-wire': entry({ kind, expires: { dataBefore: '0.3.0' } }) }
      const result = run(createFixture({ entries }))
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('[invalid-expiry] (old-wire)')
      expect(result.stderr).toContain(
        'which only `user-data` and `machine-residue` entries may use',
      )
    },
  )

  it.each(['user-data', 'machine-residue'])('allows `dataBefore` on a %s entry', kind => {
    const entries = { 'old-wire': entry({ kind, expires: { dataBefore: '0.3.0' } }) }
    expect(run(createFixture({ entries })).status).toBe(0)
  })

  it('measures that distance from package.json, not from --at', () => {
    const far = { 'old-wire': entry({ expires: { until: '0.9.0' } }) }
    const result = run(createFixture({ entries: far }), '--at', '0.8.0')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('latest allowed 0.8.0')
  })

  it('does not treat a `compat` property on an arbitrary object as an anchor', () => {
    const body = "export const x = other({\n  compat: 'old-wire',\n  note: 'legacy',\n})\n"
    const scan = scanCompatSource('src/sample.ts', body)
    expect(scan.anchors).toEqual([])
    expect(scan.signals.map(signal => signal.text)).toContain('legacy')

    const result = run(
      createFixture({
        files: {
          'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
          'src/signal.ts': body,
        },
      }),
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/signal.ts [keyword]')
  })

  it('lets a typed anchor cover the legacy hook and the callee, nothing else in the call', () => {
    const text = [
      'export const op = defineOperation({',
      "  compat: 'old-wire',",
      '  legacyNormalize: raw => raw,',
      "  summary: 'legacy summary',",
      '})',
      '',
    ].join('\n')
    const scan = scanCompatSource('src/sample.ts', text)
    expect(scan.signals.map(signal => signal.line)).toEqual([4])
  })
})

describe('compat expiry check: --update-ratchet', () => {
  const files = {
    'src/feature.ts': '// @compat old-wire\nexport const a = 1\n',
    'src/signal.ts': 'export const legacyA = 1\nexport const legacyB = 2\n',
  }
  const readBaseline = (root: string) =>
    JSON.parse(readFileSync(join(root, 'scripts/compat-ratchet.json'), 'utf8'))

  it('refuses to write when a count would rise and leaves the baseline alone', () => {
    const root = createFixture({ files, baseline: { keyword: { 'src/signal.ts': 1 } } })
    const result = run(root, '--update-ratchet')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/signal.ts [keyword]')
    expect(result.stderr).toContain('Refusing to raise the baseline')
    expect(readBaseline(root)).toEqual({ keyword: { 'src/signal.ts': 1 } })
  })

  it('refuses a signal in a file the baseline does not list', () => {
    const root = createFixture({ files, baseline: { keyword: {} } })
    expect(run(root, '--update-ratchet').status).toBe(1)
  })

  it('writes when every count stays the same or goes down', () => {
    const root = createFixture({ files, baseline: { keyword: { 'src/signal.ts': 5 } } })
    expect(run(root, '--update-ratchet').status).toBe(0)
    expect(readBaseline(root).keyword).toEqual({ 'src/signal.ts': 2 })
  })

  it('creates a missing baseline only when it never existed in git HEAD', () => {
    const root = createFixture({ files })
    const created = run(root, '--update-ratchet')
    expect(created.stderr).toBe('')
    expect(created.status).toBe(0)
    expect(readBaseline(root).keyword).toEqual({ 'src/signal.ts': 2 })

    runGit(['add', '-A'], root)
    runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base'], root)
    rmSync(join(root, 'scripts/compat-ratchet.json'))
    const refused = run(root, '--update-ratchet')
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('exists in git HEAD')

    expect(run(root, '--update-ratchet', '--bootstrap').status).toBe(0)
    expect(readBaseline(root).keyword).toEqual({ 'src/signal.ts': 2 })
  })
})

describe('compat marker parsing', () => {
  const scan = (text: string) => scanCompatSource('src/sample.ts', text)

  it('covers the full span of the next node, leading comments included', () => {
    const text = [
      '// @compat old-wire',
      '/** Explains the shim. */',
      'export function shim(value: number) {',
      '  const legacyValue = value',
      '  return legacyValue',
      '}',
      'export const legacyAfter = 1',
      '',
    ].join('\n')
    const result = scan(text)
    expect(result.problems).toEqual([])
    expect(result.markers).toHaveLength(1)
    expect(text.slice(result.markers[0].start, result.markers[0].end)).toBe(
      [
        '/** Explains the shim. */',
        'export function shim(value: number) {',
        '  const legacyValue = value',
        '  return legacyValue',
        '}',
      ].join('\n'),
    )
    expect(result.signals.map(signal => signal.line)).toEqual([7])
  })

  it('covers a class member and an object property one by one', () => {
    const text = [
      'export class A {',
      '  // @compat old-wire',
      '  legacyField = 1',
      '  legacyOther = 2',
      '}',
      'export const table = {',
      '  // @compat old-wire',
      '  legacyKey: 1,',
      '  legacyOtherKey: 2,',
      '}',
      '',
    ].join('\n')
    expect(scan(text).signals.map(signal => signal.line)).toEqual([4, 9])
  })

  it('lets a typed `compat:` anchor cover its property and the legacy callee, not the other properties', () => {
    const text = [
      'export const op = defineLegacyOperation({',
      "  compat: 'old-wire',",
      "  id: 'legacy.thing',",
      '})',
      'export const other = defineLegacyOperation({ id: 1 })',
      '',
    ].join('\n')
    const result = scan(text)
    expect(result.anchors.map(anchor => anchor.id)).toEqual(['old-wire', 'old-wire'])
    expect(result.signals.map(signal => signal.line)).toEqual([3, 5])
  })

  it('rejects a marker that is not directly above a node', () => {
    const detached = scan('// @compat old-wire\n\nexport const a = 1\n')
    expect(detached.problems).toEqual([expect.objectContaining({ line: 1, id: 'old-wire' })])
    expect(detached.markers).toEqual([])

    const dangling = scan('export const a = 1\n// @compat old-wire\n')
    expect(dangling.problems).toHaveLength(1)
  })

  it('rejects a marker without an id and a file marker below line 5', () => {
    expect(scan('// @compat\nexport const a = 1\n').problems[0].message).toContain(
      'needs a registry id',
    )
    const late = scan('\n\n\n\n\n// @compat-file old-wire\nexport const a = 1\n')
    expect(late.problems[0].message).toContain('first 5 lines')
    expect(late.markers).toEqual([])
  })

  it('covers the whole file with @compat-file', () => {
    const result = scan(
      '// @compat-file old-wire\nexport const legacyA = 1\nexport const legacyB = 2\n',
    )
    expect(result.markers[0]).toMatchObject({ id: 'old-wire', file: true })
    expect(result.signals).toEqual([])
  })
  it('covers the node an inline marker precedes, on the same line', () => {
    const text = [
      'export const a = {',
      '  value: first ?? /* @compat old-wire */ legacyFallback,',
      '  other: legacyOther,',
      '}',
      '',
    ].join('\n')
    const result = scan(text)
    expect(result.problems).toEqual([])
    expect(result.markers).toHaveLength(1)
    expect(result.signals.map(signal => signal.line)).toEqual([3])
  })

  it('covers one member of a union, including after a leading bar', () => {
    const text = [
      'export type Kind =',
      "  | 'current'",
      '  // @compat old-wire',
      "  | 'legacy'",
      "  | 'legacyOther'",
      '',
    ].join('\n')
    expect(scan(text).signals.map(signal => signal.line)).toEqual([5])
  })

  it('covers the first term of a logical chain, or a whole right operand', () => {
    const text = [
      'export const ok =',
      '  // @compat old-wire',
      '  legacyA && legacyB && legacyC',
      'export const alsoOk =',
      '  live &&',
      '  // @compat old-wire',
      '  legacyD === legacyE &&',
      '  legacyF',
      '',
    ].join('\n')
    const result = scan(text)
    expect(result.signals.map(signal => signal.text + '@' + signal.line)).toEqual([
      'legacy@3',
      'legacy@3',
      'legacy@8',
    ])
  })
})
