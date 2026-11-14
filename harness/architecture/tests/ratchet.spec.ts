import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  baselineJson,
  commitAll,
  createClonedRepository,
  git,
  removeFixtureDirectories,
} from '../../../tests/unit/scripts/ratchetRepoFixture'
import { removeTemporaryRepositories } from '../../../tests/unit/scripts/repoFixture'
import { loadArchitectureConfig, runArchitectureAudit } from '../lib/architecture-rules.mjs'
import {
  countRatchetedFindings,
  evaluateRatchet,
  planRatchetUpdate,
  updateRatchetBaseline,
} from '../lib/ratchet-baseline.mjs'
import { VARIANT_SOURCE_FILES } from './variantFixtureSupport'

const LAYER = 'architecture.layerDependency'
const WINDOW_API = 'architecture.windowOpenCoveApiBoundary'
const tempRoots: string[] = []

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'opencove-architecture-ratchet-'))
  tempRoots.push(root)
  await Promise.all(
    Object.entries({ ...VARIANT_SOURCE_FILES, ...files }).map(async ([relativePath, source]) => {
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
  'architecture.contextForbiddenLayer': {},
  'architecture.contextPublicEntry': {},
  'architecture.variantLiteralDecision.agentProvider': {},
  'architecture.variantLiteralDecision.nodeKind': {},
  'architecture.variantSwitchExhaustive.agentProvider': {},
  'architecture.variantSwitchExhaustive.nodeKind': {},
}

describe('architecture ratchet baseline', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  it('counts warn findings per rule and file', async () => {
    const { report, config } = await analyse(baseFiles)
    expect(countRatchetedFindings({ report, config })).toEqual({
      [LAYER]: baselineOf[LAYER],
      [WINDOW_API]: baselineOf[WINDOW_API],
    })
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

  it('plans the counts of every ratcheted rule, with zero-finding rules present and no stale entries', async () => {
    const { report, config } = await analyse(baseFiles)
    expect(JSON.parse(planRatchetUpdate({ report, config }).serialized)).toEqual(baselineOf)
  })
})

const BASELINE_PATH = 'harness/architecture/ratchet.json'

describe('architecture ratchet update guard', () => {
  afterEach(async () => {
    removeTemporaryRepositories()
    removeFixtureDirectories()
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  // A repository whose origin/main holds `baseline` at the architecture baseline path.
  const makeRepo = (baseline: object | null = baselineOf) =>
    createClonedRepository(baseline ? { [BASELINE_PATH]: baselineJson(baseline as never) } : {})

  async function update(root: string, files: Record<string, string>, acceptRises: string[] = []) {
    const { report, config } = await analyse(files)
    let stdout = ''
    let stderr = ''
    const code = await updateRatchetBaseline({
      root,
      report,
      config,
      acceptRises,
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
    })
    return { code, stdout, stderr }
  }

  const readBaselineFile = async (root: string) =>
    JSON.parse(await readFile(join(root, BASELINE_PATH), 'utf8'))
  const raised = { ...baseFiles, 'src/contexts/workspace/presentation/renderer/View.ts': viewTwo }

  it('refuses to update when a rule total would rise against the merge base', async () => {
    const { repo, first } = makeRepo()

    const result = await update(repo, raised)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `compared with merge base with origin/main (${first.slice(0, 8)})`,
    )
    expect(result.stderr).toContain(`${WINDOW_API}: total would rise from 1 to 2.`)
    expect(result.stderr).toContain(`\`${WINDOW_API}\` 1 -> 2: <category>: <reason>`)
    expect(await readBaselineFile(repo)).toEqual(baselineOf)
  })

  it('writes the rise when its rule is named and prints the section', async () => {
    const { repo } = makeRepo()

    const result = await update(repo, raised, [WINDOW_API])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('## 📈 Ratchet rises')
    expect((await readBaselineFile(repo))[WINDOW_API]).toEqual({
      'src/contexts/workspace/presentation/renderer/View.ts': 2,
    })
  })

  it('refuses a flag for a rule that does not rise', async () => {
    const { repo } = makeRepo()

    const result = await update(repo, baseFiles, [WINDOW_API])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `--accept-rise ${WINDOW_API}: this rule neither rises nor retires`,
    )
  })

  it('updates for drops and for a moved file with an unchanged total', async () => {
    const { repo } = makeRepo()
    const dropped = await update(repo, {
      ...baseFiles,
      'src/contexts/workspace/presentation/renderer/View.ts': 'export const run = () => 1\n',
    })
    expect(dropped).toMatchObject({ code: 0, stderr: '' })
    expect((await readBaselineFile(repo))[WINDOW_API]).toEqual({})

    await writeFile(join(repo, BASELINE_PATH), baselineJson(baselineOf as never))
    const moved = await update(repo, {
      ...baseFiles,
      'src/contexts/workspace/presentation/renderer/View.ts': 'export const run = () => 1\n',
      'src/contexts/workspace/presentation/renderer/Moved.ts': viewOne,
    })
    expect(moved.code).toBe(0)
    expect((await readBaselineFile(repo))[WINDOW_API]).toEqual({
      'src/contexts/workspace/presentation/renderer/Moved.ts': 1,
    })
  })

  it('refuses after a rule key was deleted from the file by hand', async () => {
    const { repo } = makeRepo()
    const { [WINDOW_API]: removed, ...withoutRule } = baselineOf
    expect(removed).toBeDefined()
    await writeFile(join(repo, BASELINE_PATH), baselineJson(withoutRule as never))

    const result = await update(repo, raised)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`${WINDOW_API}: total would rise from 1 to 2.`)
  })

  it('needs --accept-rise for every rule above 0 when the file is absent at the merge base', async () => {
    const { repo } = makeRepo(null)
    await mkdir(join(repo, 'harness/architecture'), { recursive: true })

    const refused = await update(repo, baseFiles)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain(`${LAYER}: total would rise from 0 to 1.`)
    expect(refused.stderr).toContain(`${WINDOW_API}: total would rise from 0 to 1.`)

    const partly = await update(repo, baseFiles, [LAYER])
    expect(partly.code).toBe(1)

    const accepted = await update(repo, baseFiles, [LAYER, WINDOW_API])
    expect(accepted.code).toBe(0)
    expect(await readBaselineFile(repo)).toEqual(baselineOf)
  })

  it('refuses to update, and writes nothing, when the audit analysed 0 files', async () => {
    const { repo } = makeRepo()
    const { report, config } = await analyse(baseFiles)
    let stderr = ''

    const code = await updateRatchetBaseline({
      root: repo,
      report: { ...report, filesAnalyzed: 0, violations: [] },
      config,
      stdout: { write: () => true },
      stderr: { write: (text: string) => (stderr += text) },
    })

    expect(code).toBe(1)
    expect(stderr).toContain('analysed 0 files')
    expect(await readBaselineFile(repo)).toEqual(baselineOf)
  })

  it('refuses regenerating after the file was deleted in a commit, with one more finding', async () => {
    const { repo } = makeRepo()
    git(repo, 'rm', '-q', BASELINE_PATH)
    commitAll(repo, 'delete the baseline')
    await mkdir(join(repo, 'harness/architecture'), { recursive: true })

    const result = await update(repo, raised)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`${WINDOW_API}: total would rise from 1 to 2.`)
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
