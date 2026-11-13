import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { areaOf } from '../../../scripts/lib/impact/areas.mjs'
import {
  createImportGraph,
  describeLayer,
  findImportLink,
  findImporters,
  groupImportersByArea,
  isRelatedTestPath,
} from '../../../scripts/lib/impact/graph.mjs'

const FILES: Record<string, string> = {
  'src/shared/lib/core.ts': 'export const core = 1\nexport type CoreShape = { a: number }\n',
  'src/shared/lib/index.ts': "export * from './core'\n",
  'src/shared/lib/outer.ts': "export { core } from './index'\n",
  'src/shared/lib/orphan.ts': 'export const orphan = 1\n',
  'src/contexts/task/application/viaBarrel.ts':
    "import { core } from '@shared/lib'\nexport const a = core\n",
  'src/contexts/task/domain/typeOnly.ts':
    "import type { CoreShape } from '../../../shared/lib/core'\nexport type T = CoreShape\n",
  'src/app/main/direct.ts': "import { core } from '@shared/lib/core'\nexport const b = core\n",
  'src/app/main/viaOuter.ts':
    "import { core } from '../../shared/lib/outer'\nexport const c = core\n",
  'tests/unit/core.spec.ts': "import { core } from '../../src/shared/lib/core'\n",
  'tests/unit/viaBarrel.spec.ts': "import { core } from '@shared/lib'\n",
  'tests/e2e/ignored.spec.ts': "import { core } from '../../src/shared/lib/core'\n",
}

let root = ''
let graph: Awaited<ReturnType<typeof createImportGraph>>

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'opencove-impact-graph-'))
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  graph = await createImportGraph(root)
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

const importersOf = (file: string) =>
  Object.fromEntries(findImporters(graph, file).map(({ file: from, ...rest }) => [from, rest]))

describe('impact graph', () => {
  it('finds direct importers across aliases and relative specifiers', () => {
    const importers = importersOf('src/shared/lib/core.ts')
    expect(importers['src/app/main/direct.ts']).toEqual({ kind: 'runtime' })
    expect(importers['src/contexts/task/domain/typeOnly.ts']).toEqual({ kind: 'type' })
  })

  it('reports the real importers of a file imported only through re-export barrels', () => {
    const importers = importersOf('src/shared/lib/core.ts')
    expect(importers['src/contexts/task/application/viaBarrel.ts']).toEqual({
      kind: 'runtime',
      via: 'src/shared/lib/index.ts',
    })
    // Two barrels deep: core <- index <- outer <- viaOuter.
    expect(importers['src/app/main/viaOuter.ts']).toEqual({
      kind: 'runtime',
      via: 'src/shared/lib/index.ts',
    })
    expect(importers['src/shared/lib/index.ts']).toEqual({ kind: 'runtime' })
  })

  it('returns no importers for an unused file and for a file that does not exist yet', () => {
    expect(importersOf('src/shared/lib/orphan.ts')).toEqual({})
    expect(importersOf('src/shared/lib/planned.ts')).toEqual({})
  })

  it('lists related tests among the importers, without Playwright suites in the test list', () => {
    const tests = findImporters(graph, 'src/shared/lib/core.ts')
      .map(importer => importer.file)
      .filter(isRelatedTestPath)
    expect(tests).toEqual(['tests/unit/core.spec.ts', 'tests/unit/viaBarrel.spec.ts'])
  })

  it('groups importers by area', () => {
    const byArea = groupImportersByArea(findImporters(graph, 'src/shared/lib/core.ts'))
    expect(Object.keys(byArea)).toEqual(['app/main', 'contexts/task', 'shared', 'tests'])
  })

  it('classifies areas and layers', () => {
    expect(areaOf('src/contexts/agent/application/A.ts')).toBe('contexts/agent')
    expect(areaOf('src/app/main/index.ts')).toBe('app/main')
    expect(areaOf('src/shared/contracts/a.ts')).toBe('shared')
    expect(areaOf('src/platform/os/a.ts')).toBe('platform')
    expect(areaOf('scripts/impact.mjs')).toBe('scripts')
    expect(areaOf('package.json')).toBe('.')
    expect(describeLayer(graph, 'src/contexts/task/domain/typeOnly.ts')).toBe('domain')
    expect(describeLayer(graph, 'src/contexts/task/application/viaBarrel.ts')).toBe('application')
    expect(describeLayer(graph, 'docs/README.md')).toBeNull()
  })

  it('tells how a partner is linked in the import graph', () => {
    expect(findImportLink(graph, 'src/shared/lib/core.ts', 'src/app/main/direct.ts')).toBe(
      'partner-imports-file',
    )
    expect(findImportLink(graph, 'src/app/main/direct.ts', 'src/shared/lib/core.ts')).toBe(
      'file-imports-partner',
    )
    expect(findImportLink(graph, 'src/shared/lib/core.ts', 'src/shared/lib/orphan.ts')).toBeNull()
    expect(findImportLink(graph, 'src/shared/lib/core.ts', 'docs/README.md')).toBeNull()
  })
})
