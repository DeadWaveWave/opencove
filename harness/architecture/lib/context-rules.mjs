import ts from 'typescript'

// Context public-entry rules. A context is a directory under `contexts.root`; its public entries are
// the files listed in `contexts.entryFiles`, relative to the context directory.

export const CONTEXT_RULE_IDS = {
  forbiddenLayer: 'architecture.contextForbiddenLayer',
  publicEntry: 'architecture.contextPublicEntry',
  entryShape: 'architecture.contextEntryShape',
  selfEntryImport: 'architecture.contextSelfEntryImport',
}

const DEFAULT_DOC = 'docs/architecture/ARCHITECTURE.md#5-依赖规则'

// Files outside every context that are held to the entry rule. `shared` is covered by
// architecture.sharedNoContextDependency, so it is not reported twice.
const OUTSIDE_PREFIXES = ['src/app/', 'src/platform/']

export function classifyContext(relativePath, contexts) {
  if (!contexts) {
    return null
  }
  const prefix = `${contexts.root}/`
  if (!relativePath.startsWith(prefix)) {
    return null
  }
  const parts = relativePath.slice(prefix.length).split('/')
  if (parts.length < 2) {
    return null
  }
  const [context, ...inside] = parts
  const inner = inside.join('/')
  return {
    context,
    layerDir: inside.length > 1 ? inside[0] : null,
    entry: contexts.entryFiles.includes(inner),
    entryDir: contexts.entryFiles.includes(inner) ? inner.replace(/\/index\.ts$/, '') : null,
  }
}

export function classifyEdgeContexts(relativePath, toRelativePath, contexts) {
  const from = classifyContext(relativePath, contexts)
  const to = toRelativePath ? classifyContext(toRelativePath, contexts) : null
  return {
    fromContext: from?.context ?? null,
    toContext: to?.context ?? null,
    toEntry: to?.entry ?? false,
  }
}

export function collectContextRuleSeverities(config) {
  const block = config.checks?.contextBoundaries
  const severities = new Map()
  if (!block) {
    return severities
  }
  for (const [key, ruleId] of Object.entries(CONTEXT_RULE_IDS)) {
    severities.set(ruleId, block[key]?.severity)
  }
  return severities
}

export function assertContextConfig(config) {
  const block = config.checks?.contextBoundaries
  if (!block) {
    return
  }
  const contexts = config.contexts
  if (
    !contexts ||
    typeof contexts.root !== 'string' ||
    !Array.isArray(contexts.entryFiles) ||
    !Array.isArray(contexts.restrictedLayerDirs)
  ) {
    throw new Error(
      'checks.contextBoundaries requires a "contexts" block with "root", "entryFiles" and "restrictedLayerDirs".',
    )
  }
  for (const key of Object.keys(CONTEXT_RULE_IDS)) {
    const severity = block[key]?.severity
    if (severity !== 'warn' && severity !== 'error') {
      throw new Error(
        `checks.contextBoundaries.${key}.severity must be exactly "warn" or "error", got ${JSON.stringify(severity)}.`,
      )
    }
  }
}

function violation(block, key, input) {
  return {
    ruleId: CONTEXT_RULE_IDS[key],
    severity: block[key].severity,
    file: input.file,
    line: input.line,
    message: input.message,
    found: input.found ?? null,
    expected: input.expected ?? null,
    doc: block.doc ?? DEFAULT_DOC,
  }
}

function edgeViolations({ relativePath, edges, config, block }) {
  const contexts = config.contexts
  const from = classifyContext(relativePath, contexts)
  const outside = OUTSIDE_PREFIXES.some(prefix => relativePath.startsWith(prefix))
  const violations = []
  for (const edge of edges) {
    if (!edge.toRelativePath || !edge.toContext) {
      continue
    }
    const to = classifyContext(edge.toRelativePath, contexts)
    if (from && from.context === to.context) {
      if (to.entry) {
        violations.push(
          violation(block, 'selfEntryImport', {
            file: relativePath,
            line: edge.line,
            found: edge.specifier,
            expected: 'Import the sibling file directly instead of the context entry.',
            message: 'A context file imports its own public entry.',
          }),
        )
      }
      continue
    }
    if (from && contexts.restrictedLayerDirs.includes(to.layerDir)) {
      violations.push(
        violation(block, 'forbiddenLayer', {
          file: relativePath,
          line: edge.line,
          found: `${from.context} -> ${to.context}/${to.layerDir} (${edge.specifier})`,
          expected: `A context must not depend on another context's ${contexts.restrictedLayerDirs.join(' or ')}. Depend on its domain or application entry, or compose in src/app.`,
          message: 'Context imports another context outside its allowed layers.',
        }),
      )
    } else if ((from || outside) && !to.entry) {
      violations.push(
        violation(block, 'publicEntry', {
          file: relativePath,
          line: edge.line,
          found: edge.specifier,
          expected: `Import ${edge.toContext} through one of its entries: ${contexts.entryFiles.join(', ')}.`,
          message: 'Deep import into another context; use its public entry.',
        }),
      )
    }
  }
  return violations
}

function isNamedReExport(statement) {
  return (
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier !== undefined &&
    statement.exportClause !== undefined &&
    ts.isNamedExports(statement.exportClause) &&
    ts.isStringLiteral(statement.moduleSpecifier)
  )
}

function entryShapeViolations({ relativePath, filePath, source, config, block, resolveTarget }) {
  const contexts = config.contexts
  const own = classifyContext(relativePath, contexts)
  if (!own?.entry) {
    return []
  }
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const ownDirPrefix = `${contexts.root}/${own.context}/${own.entryDir}/`
  const violations = []
  const report = (statement, found, expected) => {
    violations.push(
      violation(block, 'entryShape', {
        file: relativePath,
        line: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1,
        found,
        expected,
        message: 'Context entry must only re-export named symbols from its own layer directory.',
      }),
    )
  }
  for (const statement of sourceFile.statements) {
    const text = statement.getText(sourceFile).split('\n')[0]
    if (!isNamedReExport(statement)) {
      report(
        statement,
        text,
        'Only `export { ... } from` and `export type { ... } from` statements are allowed.',
      )
      continue
    }
    const target = resolveTarget(statement.moduleSpecifier.text)
    if (
      !target ||
      !target.startsWith(ownDirPrefix) ||
      !classifyContext(target, contexts) ||
      classifyContext(target, contexts).entry
    ) {
      report(statement, text, `Re-export only files under ${ownDirPrefix}.`)
    }
  }
  return violations
}

export function findContextViolations(input) {
  const block = input.config.checks?.contextBoundaries
  if (!block || !input.config.contexts) {
    return []
  }
  return [...edgeViolations({ ...input, block }), ...entryShapeViolations({ ...input, block })]
}
