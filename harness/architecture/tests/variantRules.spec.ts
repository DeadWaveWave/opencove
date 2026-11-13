import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadArchitectureConfig, runArchitectureAudit } from '../lib/architecture-rules.mjs'
import { evaluateRatchet, planRatchetUpdate } from '../lib/ratchet-baseline.mjs'
import { VARIANT_SOURCE_FILES } from './variantFixtureSupport'

const DECISION = 'architecture.variantLiteralDecision'
const SWITCH = 'architecture.variantSwitchExhaustive'
const tempRoots: string[] = []

async function createRoot(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-architecture-variants-'))
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

async function audit(files: Record<string, string>) {
  const root = await createRoot(files)
  const config = await loadArchitectureConfig()
  const report = await runArchitectureAudit({ root, config })
  const findings = report.violations
    .filter(violation => violation.ruleId.startsWith('architecture.variant'))
    .map(violation => ({ ruleId: violation.ruleId, file: violation.file }))
    .sort((a, b) => `${a.file}|${a.ruleId}`.localeCompare(`${b.file}|${b.ruleId}`))
  return { report, config, findings }
}

const decision = (file: string, times = 1) =>
  Array.from({ length: times }, () => ({ ruleId: DECISION, file }))

describe('variant rules: flagged forms', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  it('flags provider comparisons with === and !==, on either side', async () => {
    const { findings, report } = await audit({
      'src/app/a.ts':
        "export const a = (provider: string) => provider === 'codex'\nexport const b = (p: string) => 'pi' !== p\n",
    })
    expect(findings).toEqual(decision('src/app/a.ts', 2))
    const first = report.violations.find(violation => violation.ruleId === DECISION)
    expect(first).toMatchObject({ severity: 'warn', line: 1 })
    expect(first?.found).toBe("provider === 'codex'")
  })

  it('flags a provider includes() on an array literal of provider ids', async () => {
    const { findings } = await audit({
      'src/app/a.ts': "export const a = (p: string) => ['codex', 'pi'].includes(p)\n",
      'src/app/b.ts':
        "export const b = (p: string) => (['codex', 'pi'] as const).includes(p as never)\n",
    })
    expect(findings).toEqual([...decision('src/app/a.ts'), ...decision('src/app/b.ts')])
  })

  it('does not flag includes() on a list that mixes in a non-variant literal or a named list', async () => {
    const { findings } = await audit({
      'src/app/a.ts':
        "const NAMES = ['codex', 'pi']\nexport const a = (p: string) => ['codex', 'other'].includes(p) || NAMES.includes(p)\n",
    })
    expect(findings).toEqual([])
  })

  it('flags a case label in a switch over a provider that does not end in assertNever', async () => {
    const { findings } = await audit({
      'src/app/a.ts':
        "export function f(provider: string) {\n  switch (provider) {\n    case 'pi':\n      return 1\n    default:\n      return 0\n  }\n}\n",
    })
    expect(findings).toEqual([
      { ruleId: DECISION, file: 'src/app/a.ts' },
      { ruleId: SWITCH, file: 'src/app/a.ts' },
    ])
  })

  it('flags a node kind comparison in a brand-new file', async () => {
    const { findings } = await audit({
      'src/contexts/newThing/presentation/renderer/fresh.ts':
        "export const isNote = (data: { kind: string }) => data.kind === 'note'\n",
    })
    expect(findings).toEqual(decision('src/contexts/newThing/presentation/renderer/fresh.ts'))
  })

  it('flags a switch over node.data.kind without assertNever, once per switch', async () => {
    const { findings } = await audit({
      'src/app/a.ts':
        "export function f(node: { data: { kind: string } }) {\n  switch (node.data.kind) {\n    case 'task':\n    case 'note':\n      return 1\n    default:\n      return 0\n  }\n}\n",
    })
    expect(findings).toEqual([
      ...decision('src/app/a.ts', 2),
      { ruleId: SWITCH, file: 'src/app/a.ts' },
    ])
  })

  it('counts node kinds only when the compared name ends in kind, case-insensitively', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        "export const a = (x: { title: string }) => x.title === 'task'",
        "export const b = (nodeKind: string) => nodeKind === 'task'",
        "export const c = (x: { Kind: string }) => x.Kind === 'note'",
        "export const d = (x: { role: string }) => x.role === 'role'",
        "export const e = (x: { kind: string }) => ['task', 'note'].includes(x.kind)",
        "export const f = (x: { kind: string }) => x['kind'] === 'image'",
        '',
      ].join('\n'),
    })
    expect(findings).toEqual(decision('src/app/a.ts', 4))
  })

  it('reports each variant separately and ignores type-level and object-key literals', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        "export type P = 'codex' | 'pi'",
        "export const TABLE: Record<string, number> = { codex: 1, 'pi': 2 }",
        "export const same = 'codex' === 'codex'",
        "export const a = (provider: string, kind: string) => provider === 'kimi' && kind === 'agent'",
        '',
      ].join('\n'),
    })
    expect(findings).toEqual(decision('src/app/a.ts', 2))
  })

  it('leaves spec files out of scope', async () => {
    const { findings } = await audit({
      'src/app/a.spec.ts': "export const a = (provider: string) => provider === 'codex'\n",
    })
    expect(findings).toEqual([])
  })
})

describe('variant rules: allowed forms', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  it('allows node kind exit guards', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        'type D = { kind: string; ok: boolean }',
        "export function a(data: D) {\n  if (data.kind !== 'task') return\n  return 1\n}",
        "export function b(data: D) {\n  if (data.kind !== 'task') {\n    throw new Error('x')\n  }\n}",
        "export function c(data: D) {\n  if (!data.ok || data.kind !== 'task') return null\n}",
        "export function d(data: D) {\n  if ((data.kind !== 'task' || !data.ok) || data.kind !== 'note') return null\n}",
        "export function e(items: D[]) {\n  for (const data of items) {\n    if (data.kind !== 'task') continue\n  }\n}",
        "export function f(items: D[]) {\n  for (const data of items) {\n    if (data.kind !== 'task') break\n  }\n}",
        '',
      ].join('\n'),
    })
    expect(findings).toEqual([])
  })

  it('still flags node kind comparisons that are not exit guards', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        'type D = { kind: string; ok: boolean }',
        "export function a(data: D) {\n  if (data.kind === 'task') return 1\n}",
        "export function b(data: D) {\n  if (data.kind !== 'task') return 1\n  else return 2\n}",
        "export function c(data: D) {\n  if (data.kind !== 'task' && data.ok) return 1\n}",
        "export function d(data: D) {\n  if (data.kind !== 'task') {\n    data.ok = false\n    return 1\n  }\n}",
        "export function e(data: D) {\n  return data.kind !== 'task'\n}",
        '',
      ].join('\n'),
    })
    expect(findings).toEqual(decision('src/app/a.ts', 5))
  })

  it('does not extend the exit-guard allowance to providers', async () => {
    const { findings } = await audit({
      'src/app/a.ts':
        "export function a(provider: string) {\n  if (provider !== 'codex') return\n}\n",
    })
    expect(findings).toEqual(decision('src/app/a.ts'))
  })

  it('allows comparisons inside the literal owner globs and in the source and descriptor files', async () => {
    const { findings } = await audit({
      'src/contexts/agent/infrastructure/providers/codex/x.ts':
        "export const a = (provider: string) => provider === 'codex'\n",
      'src/contexts/agent/infrastructure/providers/codex/deep/y.ts':
        "export const a = (provider: string) => provider === 'codex'\n",
      'src/shared/contracts/agentProviderDescriptors.ts':
        "export const a = (provider: string) => provider === 'pi'\n",
    })
    expect(findings).toEqual([])
  })

  it('owns a literal only for its own directory', async () => {
    const { findings } = await audit({
      'src/contexts/agent/infrastructure/providers/codex/x.ts':
        "export const a = (provider: string) => provider === 'pi'\n",
    })
    expect(findings).toEqual(decision('src/contexts/agent/infrastructure/providers/codex/x.ts'))
  })

  it('treats a switch as exhaustive when it ends in assertNever for the same discriminant', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        "declare function assertNever(value: never): never\ntype K = 'task' | 'note'",
        "export function a(node: { data: { kind: K } }) {\n  switch (node.data.kind) {\n    case 'task':\n      return 1\n    case 'note':\n      return 2\n    default:\n      return assertNever(node.data.kind)\n  }\n}",
        "export function b(kind: K) {\n  switch (kind) {\n    case 'task':\n      return 1\n    case 'note':\n      return 2\n    default:\n      assertNever(kind)\n  }\n}",
        "export function c(kind: K) {\n  switch (kind) {\n    case 'task':\n      return 1\n    case 'note':\n      return 2\n    default:\n      throw assertNever(kind)\n  }\n}",
        "export function d(kind: K) {\n  switch (kind) {\n    case 'task':\n      return 1\n    case 'note':\n      return 2\n    default: {\n      const _exhaustive: never = kind\n      return _exhaustive\n    }\n  }\n}",
        '',
      ].join('\n'),
    })
    expect(findings).toEqual([])
  })

  it('does not accept a default that guards a different value or is not last', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        'declare function assertNever(value: never): never',
        "export function a(kind: string, other: never) {\n  switch (kind) {\n    case 'task':\n      return 1\n    default:\n      return assertNever(other)\n  }\n}",
        "export function b(kind: string) {\n  switch (kind) {\n    default:\n      return assertNever(kind as never)\n    case 'task':\n      return 1\n  }\n}",
        "export function c(kind: string) {\n  switch (kind) {\n    case 'task':\n      return 1\n    default:\n      console.log('x')\n      return assertNever(kind as never)\n  }\n}",
        '',
      ].join('\n'),
    })
    expect(findings).toEqual([
      ...decision('src/app/a.ts', 3),
      ...Array.from({ length: 3 }, () => ({ ruleId: SWITCH, file: 'src/app/a.ts' })),
    ])
  })
})

describe('variant rules: configuration errors', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  async function auditWith(
    files: Record<string, string>,
    edit: (config: Awaited<ReturnType<typeof loadArchitectureConfig>>) => void = () => {},
  ) {
    const root = await createRoot(files)
    const config = await loadArchitectureConfig()
    edit(config)
    return await runArchitectureAudit({ root, config })
  }

  it('errors when a configured source export was renamed or removed', async () => {
    await expect(
      auditWith({}, config => {
        config.variantRules.variants[0].source.export = 'AGENT_PROVIDER_IDS_RENAMED'
      }),
    ).rejects.toThrow(/agentProvider.*AGENT_PROVIDER_IDS_RENAMED.*found none/)
  })

  it('errors when a configured source file is missing', async () => {
    await expect(
      auditWith({}, config => {
        config.variantRules.variants[1].source.file = 'src/shared/contracts/gone.ts'
      }),
    ).rejects.toThrow(/nodeKind.*gone\.ts.*cannot read/)
  })

  it('errors when the source export is not a literal string array', async () => {
    for (const body of [
      "const A = 'a'\nexport const AGENT_PROVIDER_IDS = [A, 'b'] as const\n",
      "export const AGENT_PROVIDER_IDS = [...OTHER, 'b'] as const\n",
      'export const AGENT_PROVIDER_IDS = buildIds()\n',
      'export const AGENT_PROVIDER_IDS = [] as const\n',
    ]) {
      // eslint-disable-next-line no-await-in-loop -- each case needs its own fixture root
      await expect(auditWith({ 'src/shared/contracts/dto/agent.ts': body })).rejects.toThrow(
        /agentProvider.*found none/,
      )
    }
  })

  it('errors when an owner glob names a literal that is not in the set', async () => {
    await expect(
      auditWith({}, config => {
        config.variantRules.variants[0].ownerGlobs.mystery = ['src/**']
      }),
    ).rejects.toThrow(/"mystery".*not in the set/)
  })

  it('rejects a severity other than warn or error', async () => {
    const root = await createRoot({})
    const config = await loadArchitectureConfig()
    const path = join(root, 'rules.json')
    config.variantRules.literalDecision.severity = 'off'
    await writeFile(path, JSON.stringify(config), 'utf8')
    await expect(loadArchitectureConfig(path)).rejects.toThrow(/literalDecision.*"warn" or "error"/)
  })
})

describe('variant rules: ratchet', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
    )
  })

  const before = {
    'src/app/a.ts': "export const a = (provider: string) => provider === 'codex'\n",
  }

  it('fails the check, naming file and rule, when a new file gains a site', async () => {
    const first = await audit(before)
    const plan = planRatchetUpdate({ report: first.report, config: first.config, baseline: null })
    const baseline = JSON.parse(plan.serialized as string)
    expect(baseline[DECISION]).toEqual({ 'src/app/a.ts': 1 })

    const next = await audit({
      ...before,
      'src/app/fresh.ts': "export const f = (d: { kind: string }) => d.kind === 'note'\n",
    })
    const result = evaluateRatchet({ report: next.report, config: next.config, baseline })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({
        file: 'src/app/fresh.ts',
        rule: DECISION,
        baseline: 0,
        current: 1,
      }),
    ])
    expect(result.output).toContain('src/app/fresh.ts [architecture.variantLiteralDecision]')
  })

  it('refuses to record an increase and passes an allowed form', async () => {
    const first = await audit(before)
    const baseline = JSON.parse(
      planRatchetUpdate({ report: first.report, config: first.config, baseline: null })
        .serialized as string,
    )

    const grown = await audit({
      ...before,
      'src/app/b.ts':
        "export function f(p: string) {\n  switch (p) {\n    case 'pi':\n      return 1\n    default:\n      return 0\n  }\n}\n",
    })
    const plan = planRatchetUpdate({ report: grown.report, config: grown.config, baseline })
    expect(plan.ok).toBe(false)
    expect(plan.refusals.map(refusal => refusal.rule).sort()).toEqual([DECISION, SWITCH])

    const allowed = await audit({
      ...before,
      'src/app/guard.ts':
        "export function g(d: { kind: string }) {\n  if (d.kind !== 'task') return\n}\n",
    })
    expect(evaluateRatchet({ report: allowed.report, config: allowed.config, baseline }).ok).toBe(
      true,
    )
  })
})
