import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadArchitectureConfig, runArchitectureAudit } from '../lib/architecture-rules.mjs'
import { evaluateRatchet, planRatchetUpdate } from '../lib/ratchet-baseline.mjs'
import { VARIANT_SOURCE_FILES } from './variantFixtureSupport'

const PROVIDER = 'agentProvider'
const NODE = 'nodeKind'
const DECISION_BASE = 'architecture.variantLiteralDecision'
const SWITCH_BASE = 'architecture.variantSwitchExhaustive'
const decisionId = (variant: string) => `${DECISION_BASE}.${variant}`
const switchId = (variant: string) => `${SWITCH_BASE}.${variant}`
const NEVER_HELPER = {
  'src/shared/utils/assertNever.ts':
    'export function assertNever(value: never): never { throw new Error(String(value)) }\n',
}
const NEVER_IMPORT = "import { assertNever } from '@shared/utils/assertNever'\n"
const tempRoots: string[] = []

async function createRoot(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-architecture-variants-'))
  tempRoots.push(root)
  await Promise.all(
    Object.entries({ ...VARIANT_SOURCE_FILES, ...NEVER_HELPER, ...files }).map(
      async ([relativePath, source]) => {
        const filePath = join(root, relativePath)
        await mkdir(dirname(filePath), { recursive: true })
        await writeFile(filePath, source, 'utf8')
      },
    ),
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

const decision = (file: string, times = 1, variant = PROVIDER) =>
  Array.from({ length: times }, () => ({ ruleId: decisionId(variant), file }))
const notExhaustive = (file: string, times = 1, variant = PROVIDER) =>
  Array.from({ length: times }, () => ({ ruleId: switchId(variant), file }))

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
    const first = report.violations.find(violation => violation.ruleId === decisionId(PROVIDER))
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
    expect(findings).toEqual([...decision('src/app/a.ts'), ...notExhaustive('src/app/a.ts')])
  })

  it('flags a node kind comparison in a brand-new file', async () => {
    const { findings } = await audit({
      'src/contexts/newThing/presentation/renderer/fresh.ts':
        "export const isNote = (data: { kind: string }) => data.kind === 'note'\n",
    })
    expect(findings).toEqual(
      decision('src/contexts/newThing/presentation/renderer/fresh.ts', 1, NODE),
    )
  })

  it('flags a switch over node.data.kind without assertNever, once per switch', async () => {
    const { findings } = await audit({
      'src/app/a.ts':
        "export function f(node: { data: { kind: string } }) {\n  switch (node.data.kind) {\n    case 'task':\n    case 'note':\n      return 1\n    default:\n      return 0\n  }\n}\n",
    })
    expect(findings).toEqual([
      ...decision('src/app/a.ts', 2, NODE),
      ...notExhaustive('src/app/a.ts', 1, NODE),
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
    expect(findings).toEqual(decision('src/app/a.ts', 4, NODE))
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
    expect(findings).toEqual([
      ...decision('src/app/a.ts', 1, PROVIDER),
      ...decision('src/app/a.ts', 1, NODE),
    ])
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

  // Each entry is a function whose guard is `if (data.kind !== 'task') <exit>`.
  const guardFile = (exits: string[], prefix = '') =>
    [
      prefix,
      'type D = { kind: string; ok: boolean; value: number }',
      'declare function compute(): number',
      'declare const outer: { a: { b: number } }',
      ...exits.map(
        (exit, index) =>
          `export function f${index}(data: D, items: D[]) {\n  if (data.kind !== 'task') ${exit}\n}`,
      ),
      '',
    ].join('\n')

  it.each([
    'return',
    'return;',
    'return null',
    'return undefined',
    'return true',
    "return 'x'",
    'return `plain`',
    'return 3',
    'return -1',
    'return data',
    'return data.value',
    'return outer.a.b',
    'return []',
    'return {}',
    "throw new Error('x')",
    "{ throw new Error('x') }",
  ])('allows the pure exit guard: %s', async exit => {
    const { findings } = await audit({ 'src/app/a.ts': guardFile([exit]) })
    expect(findings).toEqual([])
  })

  it.each(['continue', 'break'])('allows the pure loop exit guard: %s', async exit => {
    const { findings } = await audit({
      'src/app/a.ts': `type D = { kind: string }\nexport function f(items: D[]) {\n  for (const data of items) {\n    if (data.kind !== 'task') ${exit}\n  }\n}\n`,
    })
    expect(findings).toEqual([])
  })

  it('allows a guard as one || operand and through parentheses', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        'type D = { kind: string; ok: boolean }',
        "export function c(data: D) {\n  if (!data.ok || data.kind !== 'task') return null\n}",
        "export function d(data: D) {\n  if ((data.kind !== 'task' || !data.ok) || data.kind !== 'note') return null\n}",
        '',
      ].join('\n'),
    })
    expect(findings).toEqual([])
  })

  it.each([
    'return compute()',
    'return new Date()',
    'return data.ok ? 1 : 2',
    'return [1]',
    'return { a: 1 }',
    'return `x${data.value}`',
    'return data.value + 1',
    'return items[0]',
    'return data.value.toFixed()',
    'return (compute())',
    'return -data.value',
    'return !data.ok',
  ])('counts a guard whose exit computes something: %s', async exit => {
    const { findings, report } = await audit({ 'src/app/a.ts': guardFile([exit]) })
    expect(findings).toEqual(decision('src/app/a.ts', 1, NODE))
    expect(report.violations.find(v => v.ruleId === decisionId(NODE))).toMatchObject({
      guardShaped: true,
    })
  })

  it('counts a guard that returns await or JSX', async () => {
    const { findings } = await audit({
      'src/app/a.tsx':
        "type D = { kind: string }\nexport async function f(data: D) {\n  if (data.kind !== 'task') return await Promise.resolve(1)\n}\nexport function g(data: D) {\n  if (data.kind !== 'task') return <div />\n}\n",
    })
    expect(findings).toEqual(decision('src/app/a.tsx', 2, NODE))
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
    expect(findings).toEqual(decision('src/app/a.ts', 5, NODE))
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

  const kindSwitch = (tail: string, discriminant = 'kind') =>
    `export function f(kind: K, node: { data: { kind: K } }) {\n  switch (${discriminant}) {\n    case 'task':\n      return 1\n    case 'note':\n      return 2\n    default:\n${tail}\n  }\n}`

  it('treats a switch as exhaustive when it ends in the shared assertNever for the same discriminant', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        NEVER_IMPORT + "type K = 'task' | 'note'",
        kindSwitch('      return assertNever(node.data.kind)', 'node.data.kind').replace(
          'function f',
          'function a',
        ),
        kindSwitch('      assertNever(kind)').replace('function f', 'function b'),
        kindSwitch('      throw assertNever(kind)').replace('function f', 'function c'),
        kindSwitch('      return assertNever(kind, "message")').replace('function f', 'function e'),
        '',
      ].join('\n'),
      'src/app/relative.ts': [
        "import { assertNever as never } from '../shared/utils/assertNever'\ntype K = 'task' | 'note'",
        kindSwitch('      return never(kind)'),
        '',
      ].join('\n'),
    })
    expect(findings).toEqual([])
  })

  it('accepts the legacy never declaration, with or without plain parentheses', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        "type K = 'task' | 'note'",
        kindSwitch('      { const _exhaustive: never = kind; return _exhaustive }').replace(
          'function f',
          'function a',
        ),
        kindSwitch('      { const _exhaustive: never = (kind); return _exhaustive }').replace(
          'function f',
          'function b',
        ),
        kindSwitch(
          '      { const _exhaustive: never = node.data.kind; return _exhaustive }',
          'node.data.kind',
        ).replace('function f', 'function c'),
        '',
      ].join('\n'),
    })
    expect(findings).toEqual([])
  })

  it.each([
    ['as never', 'kind as never'],
    ['satisfies never', 'kind satisfies never'],
    ['non-null assertion', 'kind!'],
    ['angle-bracket cast', '<never>kind'],
  ])('does not accept a cast in the legacy never declaration: %s', async (_name, initializer) => {
    const { findings } = await audit({
      'src/app/a.ts': [
        "type K = 'task' | 'note' | 'extra'",
        kindSwitch(`      { const _x: never = ${initializer}; return _x }`),
        '',
      ].join('\n'),
    })
    expect(findings).toEqual([
      ...decision('src/app/a.ts', 2, NODE),
      ...notExhaustive('src/app/a.ts', 1, NODE),
    ])
  })

  it('does not accept a default that guards a different value or is not last', async () => {
    const { findings } = await audit({
      'src/app/a.ts': [
        NEVER_IMPORT.trim(),
        "export function a(kind: string, other: never) {\n  switch (kind) {\n    case 'task':\n      return 1\n    default:\n      return assertNever(other)\n  }\n}",
        "export function b(kind: string) {\n  switch (kind) {\n    default:\n      return assertNever(kind as never)\n    case 'task':\n      return 1\n  }\n}",
        "export function c(kind: string) {\n  switch (kind) {\n    case 'task':\n      return 1\n    default:\n      console.log('x')\n      return assertNever(kind as never)\n  }\n}",
        '',
      ].join('\n'),
    })
    expect(findings).toEqual([
      ...decision('src/app/a.ts', 3, NODE),
      ...notExhaustive('src/app/a.ts', 3, NODE),
    ])
  })

  it('only counts the shared assertNever: a local function or another import does not', async () => {
    const tail =
      "type K = 'task'\nexport function f(kind: K) {\n  switch (kind) {\n    case 'task':\n      return 1\n    default:\n      return assertNever(kind)\n  }\n}\n"
    const { findings } = await audit({
      'src/app/local.ts': `const assertNever = (x: unknown) => 0\n${tail}`,
      'src/app/other.ts': `import { assertNever } from './elsewhere'\n${tail}`,
      'src/app/elsewhere.ts':
        'export function assertNever(value: never): never { throw new Error(String(value)) }\n',
      'src/app/ok.ts': `${NEVER_IMPORT}${tail}`,
    })
    expect(findings).toEqual([
      ...decision('src/app/local.ts', 1, NODE),
      ...notExhaustive('src/app/local.ts', 1, NODE),
      ...decision('src/app/other.ts', 1, NODE),
      ...notExhaustive('src/app/other.ts', 1, NODE),
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
    expect(baseline[decisionId(PROVIDER)]).toEqual({ 'src/app/a.ts': 1 })

    const next = await audit({
      ...before,
      'src/app/fresh.ts': "export const f = (d: { kind: string }) => d.kind === 'note'\n",
    })
    const result = evaluateRatchet({ report: next.report, config: next.config, baseline })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({
        file: 'src/app/fresh.ts',
        rule: decisionId(NODE),
        baseline: 0,
        current: 1,
      }),
    ])
    expect(result.output).toContain(
      'src/app/fresh.ts [architecture.variantLiteralDecision.nodeKind]',
    )
  })

  it('does not let a fall in one variant pay for a rise in another', async () => {
    const files = {
      'src/app/provider.ts': "export const a = (provider: string) => provider === 'codex'\n",
      'src/app/node.ts': "export const b = (d: { kind: string }) => d.kind === 'note'\n",
    }
    const first = await audit(files)
    const baseline = JSON.parse(
      planRatchetUpdate({ report: first.report, config: first.config, baseline: null })
        .serialized as string,
    )
    expect(baseline[decisionId(PROVIDER)]).toEqual({ 'src/app/provider.ts': 1 })
    expect(baseline[decisionId(NODE)]).toEqual({ 'src/app/node.ts': 1 })

    // +1 provider comparison, -1 node kind comparison: the combined total is unchanged.
    const swapped = await audit({
      'src/app/provider.ts':
        "export const a = (provider: string) => provider === 'codex'\nexport const c = (provider: string) => provider === 'pi'\n",
      'src/app/node.ts': 'export const b = 1\n',
    })
    const plan = planRatchetUpdate({ report: swapped.report, config: swapped.config, baseline })
    expect(plan.ok).toBe(false)
    expect(plan.refusals).toEqual([{ rule: decisionId(PROVIDER), before: 1, after: 2 }])
    expect(plan.serialized).toBeNull()
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
    expect(plan.refusals.map(refusal => refusal.rule).sort()).toEqual([
      decisionId(PROVIDER),
      switchId(PROVIDER),
    ])

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
