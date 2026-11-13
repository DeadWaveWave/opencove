import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadArchitectureConfig, runArchitectureAudit } from '../lib/architecture-rules.mjs'
import {
  countRatchetedFindings,
  evaluateRatchet,
  planRatchetUpdate,
} from '../lib/ratchet-baseline.mjs'

const LAYER = 'architecture.layerDependency'
const WINDOW_API = 'architecture.windowOpenCoveApiBoundary'
const tempRoots: string[] = []

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'opencove-architecture-ratchet-'))
  tempRoots.push(root)
  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const filePath = join(root, relativePath)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, source, 'utf8')
    }),
  )
  return root
}

const store = 'export function load() { return 1 }\n'
const domainModel = "import { load } from '../infrastructure/store'\nexport const value = load()\n"
const viewOne = 'export const run = () => window.opencoveApi.a()\n'
const viewTwo =
  'export const a = () => window.opencoveApi.a()\nexport const b = () => window.opencoveApi.b()\n'

const baseFiles = {
  'src/contexts/workspace/infrastructure/store.ts': store,
  'src/contexts/workspace/domain/model.ts': domainModel,
  'src/contexts/workspace/presentation/renderer/View.ts': viewOne,
}

async function analyse(files: Record<string, string>) {
  const root = await createFixture(files)
  const config = await loadArchitectureConfig()
  const report = await runArchitectureAudit({ root, config })
  return { report, config }
}

const baselineOf = {
  [LAYER]: { 'src/contexts/workspace/domain/model.ts': 1 },
  [WINDOW_API]: { 'src/contexts/workspace/presentation/renderer/View.ts': 1 },
}

describe('architecture ratchet baseline', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  it('counts warn findings per rule and file', async () => {
    const { report, config } = await analyse(baseFiles)
    expect(countRatchetedFindings({ report, config })).toEqual(baselineOf)
  })

  it('passes when counts match the baseline', async () => {
    const { report, config } = await analyse(baseFiles)
    const result = evaluateRatchet({ report, config, baseline: baselineOf })
    expect(result.ok).toBe(true)
    expect(result.output).toBe('')
  })

  it('fails on a violation in a file that is not in the baseline', async () => {
    const { report, config } = await analyse({
      ...baseFiles,
      'src/contexts/workspace/presentation/renderer/Other.ts': viewOne,
    })
    const result = evaluateRatchet({ report, config, baseline: baselineOf })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('src/contexts/workspace/presentation/renderer/Other.ts')
    expect(result.output).toContain(WINDOW_API)
  })

  it('fails on an extra finding in a baselined file', async () => {
    const { report, config } = await analyse({
      ...baseFiles,
      'src/contexts/workspace/presentation/renderer/View.ts': viewTwo,
    })
    const result = evaluateRatchet({ report, config, baseline: baselineOf })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('View.ts')
    expect(result.output).not.toContain('pnpm arch:ratchet')
  })

  it('fails on a drop and tells the author to run pnpm arch:ratchet', async () => {
    const { report, config } = await analyse({
      ...baseFiles,
      'src/contexts/workspace/presentation/renderer/View.ts': 'export const run = () => 1\n',
    })
    const result = evaluateRatchet({ report, config, baseline: baselineOf })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('dropped from 1 to 0')
    expect(result.output).toContain('pnpm arch:ratchet')
    expect(result.output).toContain('harness/architecture/ratchet.json')
  })

  it('fails on any error-level finding', async () => {
    const { report, config } = await analyse({
      ...baseFiles,
      'src/contexts/workspace/domain/runtime.ts': "import 'electron'\n",
    })
    const result = evaluateRatchet({ report, config, baseline: baselineOf })
    expect(result.ok).toBe(false)
    expect(result.errors.map(error => error.ruleId)).toEqual(['architecture.domainNoOuterRuntime'])
    expect(result.output).toContain('src/contexts/workspace/domain/runtime.ts')
  })

  it('fails when the baseline names an unknown or an error-level rule', async () => {
    const { report, config } = await analyse(baseFiles)
    const unknown = evaluateRatchet({
      report,
      config,
      baseline: { ...baselineOf, 'architecture.noSuchRule': { 'src/a.ts': 1 } },
    })
    expect(unknown.ok).toBe(false)
    expect(unknown.output).toContain('architecture.noSuchRule')
    expect(unknown.output).toContain('unknown rule')

    const errorLevel = evaluateRatchet({
      report,
      config,
      baseline: { ...baselineOf, 'architecture.domainNoOuterRuntime': { 'src/a.ts': 1 } },
    })
    expect(errorLevel.ok).toBe(false)
    expect(errorLevel.output).toContain('architecture.domainNoOuterRuntime')
    expect(errorLevel.output).toContain('error-level')
  })

  it('refuses to update when a rule total in the baseline would rise', async () => {
    const { report, config } = await analyse({
      ...baseFiles,
      'src/contexts/workspace/presentation/renderer/View.ts': viewTwo,
    })
    const plan = planRatchetUpdate({ report, config, baseline: baselineOf })
    expect(plan.ok).toBe(false)
    expect(plan.refusals).toEqual([{ rule: WINDOW_API, before: 1, after: 2 }])
    expect(plan.serialized).toBeNull()
  })

  it('updates for drops', async () => {
    const { report, config } = await analyse({
      ...baseFiles,
      'src/contexts/workspace/presentation/renderer/View.ts': 'export const run = () => 1\n',
    })
    const plan = planRatchetUpdate({ report, config, baseline: baselineOf })
    expect(plan.ok).toBe(true)
    expect(JSON.parse(plan.serialized)).toEqual({
      [LAYER]: baselineOf[LAYER],
      [WINDOW_API]: {},
    })
  })

  it('updates for a moved file with an unchanged total', async () => {
    const { report, config } = await analyse({
      ...baseFiles,
      'src/contexts/workspace/presentation/renderer/View.ts': 'export const run = () => 1\n',
      'src/contexts/workspace/presentation/renderer/Moved.ts': viewOne,
    })
    const plan = planRatchetUpdate({ report, config, baseline: baselineOf })
    expect(plan.ok).toBe(true)
    expect(JSON.parse(plan.serialized)[WINDOW_API]).toEqual({
      'src/contexts/workspace/presentation/renderer/Moved.ts': 1,
    })
  })

  it('records the first counts of a rule that is absent from the baseline', async () => {
    const { report, config } = await analyse(baseFiles)
    const plan = planRatchetUpdate({
      report,
      config,
      baseline: { [LAYER]: baselineOf[LAYER] },
    })
    expect(plan.ok).toBe(true)
    expect(JSON.parse(plan.serialized)[WINDOW_API]).toEqual(baselineOf[WINDOW_API])
  })

  it('bootstraps when no baseline exists and drops invalid baseline entries', async () => {
    const { report, config } = await analyse(baseFiles)
    expect(JSON.parse(planRatchetUpdate({ report, config, baseline: null }).serialized)).toEqual(
      baselineOf,
    )
    const cleaned = planRatchetUpdate({
      report,
      config,
      baseline: { ...baselineOf, 'architecture.noSuchRule': { 'src/a.ts': 3 } },
    })
    expect(JSON.parse(cleaned.serialized)).toEqual(baselineOf)
  })
})

describe('architecture exceptions', () => {
  it('rejects an allowedEdges entry without a reason', async () => {
    const config = await loadArchitectureConfig()
    const edge = { fromPatterns: ['src/app/a.ts'], toLayers: ['application'] }
    const root = await mkdtemp(join(tmpdir(), 'opencove-architecture-reason-'))
    tempRoots.push(root)
    const write = async (name: string, reason: unknown) => {
      const path = join(root, name)
      const entry = reason === undefined ? edge : { ...edge, reason }
      await writeFile(
        path,
        JSON.stringify({
          ...config,
          checks: {
            ...config.checks,
            layerDependencies: { ...config.checks.layerDependencies, allowedEdges: [entry] },
          },
        }),
      )
      return path
    }

    await expect(loadArchitectureConfig(await write('missing.json', undefined))).rejects.toThrow(
      /reason/,
    )
    await expect(loadArchitectureConfig(await write('blank.json', '  '))).rejects.toThrow(/reason/)
    await expect(loadArchitectureConfig(await write('ok.json', 'because'))).resolves.toBeTruthy()
  })

  it('rejects a severity other than warn or error anywhere in the config', async () => {
    const config = await loadArchitectureConfig()
    const root = await mkdtemp(join(tmpdir(), 'opencove-architecture-severity-'))
    tempRoots.push(root)
    const load = async (name: string, checks: Record<string, unknown>) => {
      const path = join(root, name)
      await writeFile(path, JSON.stringify({ ...config, checks: { ...config.checks, ...checks } }))
      return await loadArchitectureConfig(path)
    }
    const withSeverity = (key: string, severity: unknown) => ({
      [key]: config.checks[key].map((rule: object, index: number) =>
        index === 0 ? { ...rule, severity } : rule,
      ),
    })

    await expect(load('text.json', withSeverity('forbiddenText', 'off'))).rejects.toThrow(
      /severity/,
    )
    await expect(load('text2.json', withSeverity('forbiddenText', 'warning'))).rejects.toThrow(
      /severity/,
    )
    await expect(
      load('import.json', withSeverity('forbiddenImportSpecifiers', undefined)),
    ).rejects.toThrow(/severity/)
    await expect(
      load('layer.json', {
        layerDependencies: { ...config.checks.layerDependencies, severity: 'off' },
      }),
    ).rejects.toThrow(/severity/)
    await expect(
      load('bridge.json', {
        rendererBridge: { ...config.checks.rendererBridge, severity: 'info' },
      }),
    ).rejects.toThrow(/severity/)
    await expect(load('cycle.json', { fileRuntimeCycles: { severity: 'off' } })).rejects.toThrow(
      /severity/,
    )
    await expect(load('ok.json', withSeverity('forbiddenText', 'error'))).resolves.toBeTruthy()
  })
})
