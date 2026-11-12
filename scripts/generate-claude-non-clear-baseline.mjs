import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, posix, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
const ref = process.argv[2] ?? 'origin/main'
const commit = git('rev-parse', '--verify', `${ref}^{commit}`).trim()
const paths = new Set(git('ls-tree', '-r', '--name-only', commit).trim().split('\n'))
const base = resolve(root, 'tests/fixtures/claude/non-clear')
mkdirSync(resolve(base, 'baseline'), { recursive: true })
const temporary = mkdtempSync(resolve(base, 'baseline/run-'))
const manifest = {}
function dependencies(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const imports = []
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (node.isTypeOnly || node.importClause?.isTypeOnly) {
        return
      }
      imports.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return imports
}
function extract(path) {
  if (manifest[path]) {
    return
  }
  const source = git('show', `${commit}:${path}`)
  manifest[path] = createHash('sha256').update(source).digest('hex')
  const output = resolve(temporary, path)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, source)
  for (const specifier of dependencies(source, path)) {
    let stem
    if (specifier.startsWith('.')) {
      stem = posix.normalize(posix.join(posix.dirname(path), specifier))
    } else if (/^@(app|contexts|platform|shared)\//.test(specifier)) {
      throw new Error(`Cannot isolate baseline runtime alias ${specifier} in ${path}`)
    } else {
      continue
    }
    const dependency = [
      stem,
      `${stem}.ts`,
      `${stem}.tsx`,
      `${stem}.js`,
      `${stem}.json`,
      `${stem}/index.ts`,
    ].find(candidate => paths.has(candidate))
    if (!dependency) {
      throw new Error(`Missing baseline dependency: ${path} -> ${specifier}`)
    }
    extract(dependency)
  }
}
try {
  const entries = [
    'src/contexts/agent/application/AgentRunStateRegistry.ts',
    'src/contexts/agent/application/AgentRunStateRuntime.ts',
    'src/contexts/agent/application/promptAdmission.ts',
    'src/app/main/controlSurface/agentHook/claudeHookChannel.ts',
    'src/contexts/terminal/presentation/main-ipc/sessionStateWatcherPublisher.ts',
    'src/shared/runtime/agentHook/claudePromptEvidence.ts',
  ]
  for (const path of entries) {
    extract(path)
  }
  writeFileSync(
    resolve(temporary, 'entry.ts'),
    entries.map(path => `export * from './${path.slice(0, -3)}'`).join('\n') + '\n',
  )
  const runner = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(
    runner,
    ['test', '--', '--run', 'tests/unit/app/claudeNonClearCompatibility.spec.ts', '--maxWorkers=1'],
    {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, OPENCOVE_NON_CLEAR_BASELINE: temporary },
    },
  )
  if (result.status !== 0) {
    throw new Error(`Baseline execution failed: ${result.status}`)
  }
  cpSync(resolve(temporary, 'results'), resolve(base, 'goldens'), { recursive: true })
  writeFileSync(
    resolve(base, 'manifest.json'),
    JSON.stringify({ commit, entries, sources: manifest }, null, 2) + '\n',
  )
  process.stdout.write(
    `Generated non-clear goldens from ${commit}; ${Object.keys(manifest).length} source files\n`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
