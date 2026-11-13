import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadArchitectureConfig, runArchitectureAudit } from '../lib/architecture-rules.mjs'
import { classifyContext, classifyEdgeContexts } from '../lib/context-rules.mjs'
import { evaluateRatchet } from '../lib/ratchet-baseline.mjs'

const FORBIDDEN = 'architecture.contextForbiddenLayer'
const PUBLIC = 'architecture.contextPublicEntry'
const SHAPE = 'architecture.contextEntryShape'
const SELF = 'architecture.contextSelfEntryImport'
const tempRoots: string[] = []

async function audit(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-architecture-contexts-'))
  tempRoots.push(root)
  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const filePath = join(root, relativePath)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, source, 'utf8')
    }),
  )
  const config = await loadArchitectureConfig()
  const report = await runArchitectureAudit({ root, config })
  const contextFindings = report.violations
    .filter(violation => violation.ruleId.startsWith('architecture.context'))
    .map(violation => ({ ruleId: violation.ruleId, file: violation.file }))
  return { report, config, contextFindings }
}

const bDomain = {
  'src/contexts/b/domain/index.ts': "export { thing } from './x'\n",
  'src/contexts/b/domain/x.ts': 'export const thing = 1\n',
}

describe('context identity', () => {
  it('classifies contexts, layer directories and entries', async () => {
    const { contexts } = await loadArchitectureConfig()
    expect(classifyContext('src/contexts/b/domain/index.ts', contexts)).toMatchObject({
      context: 'b',
      layerDir: 'domain',
      entry: true,
      entryDir: 'domain',
    })
    expect(
      classifyContext('src/contexts/b/presentation/renderer/index.ts', contexts),
    ).toMatchObject({
      context: 'b',
      layerDir: 'presentation',
      entry: true,
      entryDir: 'presentation/renderer',
    })
    expect(classifyContext('src/contexts/b/presentation/index.ts', contexts)?.entry).toBe(false)
    expect(classifyContext('src/contexts/b/domain/sub/index.ts', contexts)?.entry).toBe(false)
    expect(classifyContext('src/app/main/index.ts', contexts)).toBeNull()
    expect(
      classifyEdgeContexts('src/app/main/a.ts', 'src/contexts/b/domain/index.ts', contexts),
    ).toEqual({ fromContext: null, toContext: 'b', toEntry: true })
  })
})

describe('context public entries', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  it('rejects a deep import from another context', async () => {
    const { contextFindings } = await audit({
      ...bDomain,
      'src/contexts/a/domain/a.ts':
        "import { thing } from '@contexts/b/domain/x'\nexport const a = thing\n",
    })
    expect(contextFindings).toEqual([{ ruleId: PUBLIC, file: 'src/contexts/a/domain/a.ts' }])
  })

  it('rejects the same import as a relative path or as a type-only import', async () => {
    const { contextFindings } = await audit({
      ...bDomain,
      'src/contexts/a/domain/rel.ts':
        "import { thing } from '../../b/domain/x'\nexport const a = thing\n",
      'src/contexts/a/domain/type.ts':
        "import type { thing } from '@contexts/b/domain/x'\nexport type A = typeof thing\n",
      'src/contexts/a/domain/inline.ts': "export type A = import('@contexts/b/domain/x').T\n",
    })
    expect(contextFindings).toEqual([
      { ruleId: PUBLIC, file: 'src/contexts/a/domain/inline.ts' },
      { ruleId: PUBLIC, file: 'src/contexts/a/domain/rel.ts' },
      { ruleId: PUBLIC, file: 'src/contexts/a/domain/type.ts' },
    ])
  })

  it('reports a forbidden layer once, even through the entry', async () => {
    const { contextFindings } = await audit({
      'src/contexts/b/presentation/renderer/index.ts': "export { View } from './View'\n",
      'src/contexts/b/presentation/renderer/View.ts': 'export const View = 1\n',
      'src/contexts/a/presentation/renderer/viaEntry.ts':
        "import { View } from '@contexts/b/presentation/renderer'\nexport const a = View\n",
      'src/contexts/a/presentation/renderer/deep.ts':
        "import { View } from '@contexts/b/presentation/renderer/View'\nexport const a = View\n",
    })
    expect(contextFindings).toEqual([
      { ruleId: FORBIDDEN, file: 'src/contexts/a/presentation/renderer/deep.ts' },
      { ruleId: FORBIDDEN, file: 'src/contexts/a/presentation/renderer/viaEntry.ts' },
    ])
  })

  it('rejects a deep import from a composition root but accepts its entries', async () => {
    const { contextFindings } = await audit({
      ...bDomain,
      'src/contexts/b/presentation/renderer/index.ts': "export { View } from './View'\n",
      'src/contexts/b/presentation/renderer/View.ts': 'export const View = 1\n',
      'src/app/renderer/x.ts':
        "import { thing } from '@contexts/b/domain/x'\nexport const x = thing\n",
      'src/app/renderer/y.ts':
        "import { thing } from '@contexts/b/domain'\nimport { View } from '@contexts/b/presentation/renderer'\nexport const y = [thing, View]\n",
    })
    expect(contextFindings).toEqual([{ ruleId: PUBLIC, file: 'src/app/renderer/x.ts' }])
  })

  it('accepts imports through domain and application entries and intra-context deep imports', async () => {
    const { contextFindings } = await audit({
      ...bDomain,
      'src/contexts/b/application/index.ts': "export { use } from './use'\n",
      'src/contexts/b/application/use.ts': 'export const use = 1\n',
      'src/contexts/b/application/other.ts':
        "import { thing } from '../domain/x'\nimport { use } from './use'\nexport const other = [thing, use]\n",
      'src/contexts/a/application/a.ts':
        "import { thing } from '@contexts/b/domain'\nimport { use } from '@contexts/b/application'\nexport const a = [thing, use]\n",
    })
    expect(contextFindings).toEqual([])
  })

  it('leaves spec files out of scope', async () => {
    const { contextFindings } = await audit({
      ...bDomain,
      'src/contexts/a/domain/a.spec.ts':
        "import { thing } from '@contexts/b/domain/x'\nexport const a = thing\n",
    })
    expect(contextFindings).toEqual([])
  })

  it('rejects entries that are not plain named re-exports of their own layer', async () => {
    const { contextFindings, report } = await audit({
      'src/contexts/b/domain/x.ts': 'export const thing = 1\n',
      'src/contexts/b/domain/index.ts': "export * from './x'\n",
      'src/contexts/b/application/index.ts':
        "export const local = 1\nexport { thing } from '../domain/x'\n",
      'src/contexts/b/application/use.ts': 'export const use = 1\n',
      'src/contexts/b/infrastructure/index.ts': "export { thing } from '@contexts/c/domain/x'\n",
      'src/contexts/c/domain/x.ts': 'export const thing = 1\n',
      'src/contexts/b/presentation/main-ipc/index.ts': 'export {}\n',
    })
    expect(contextFindings.filter(finding => finding.ruleId === SHAPE)).toEqual([
      { ruleId: SHAPE, file: 'src/contexts/b/application/index.ts' },
      { ruleId: SHAPE, file: 'src/contexts/b/application/index.ts' },
      { ruleId: SHAPE, file: 'src/contexts/b/domain/index.ts' },
      { ruleId: SHAPE, file: 'src/contexts/b/infrastructure/index.ts' },
      { ruleId: SHAPE, file: 'src/contexts/b/presentation/main-ipc/index.ts' },
    ])
    expect(report.violations.find(violation => violation.ruleId === SHAPE)?.severity).toBe('error')
  })

  it('accepts entries made of named and type-only re-exports', async () => {
    const { contextFindings } = await audit({
      'src/contexts/b/domain/index.ts':
        "export { thing, type Other } from './x'\nexport type { Third } from './sub/y'\n",
      'src/contexts/b/domain/x.ts': 'export const thing = 1\nexport type Other = number\n',
      'src/contexts/b/domain/sub/y.ts': 'export type Third = string\n',
    })
    expect(contextFindings).toEqual([])
  })

  it('rejects a context importing its own entry', async () => {
    const { contextFindings, report } = await audit({
      ...bDomain,
      'src/contexts/b/application/use.ts':
        "import { thing } from '@contexts/b/domain'\nexport const use = thing\n",
      'src/contexts/b/domain/y.ts': "import { thing } from './index'\nexport const y = thing\n",
    })
    expect(contextFindings).toEqual([
      { ruleId: SELF, file: 'src/contexts/b/application/use.ts' },
      { ruleId: SELF, file: 'src/contexts/b/domain/y.ts' },
    ])
    expect(report.summary.errors).toBeGreaterThan(0)
  })

  it('makes the ratchet fail on a new deep import and on an unrecorded drop', async () => {
    const { report, config } = await audit({
      ...bDomain,
      'src/contexts/a/domain/a.ts':
        "import { thing } from '@contexts/b/domain/x'\nexport const a = thing\n",
    })
    const recorded = { [PUBLIC]: { 'src/contexts/a/domain/a.ts': 1 } }
    expect(evaluateRatchet({ report, config, baseline: recorded }).ok).toBe(true)
    expect(evaluateRatchet({ report, config, baseline: { [PUBLIC]: {} } }).ok).toBe(false)
    expect(
      evaluateRatchet({
        report,
        config,
        baseline: { [PUBLIC]: { 'src/contexts/a/domain/a.ts': 2 } },
      }).ok,
    ).toBe(false)
  })
})
