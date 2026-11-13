import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

// Variant rules. A variant is a closed set of string ids (agent providers, node kinds). Code that
// decides what to do by comparing a variant's identity belongs to the variant's own registry entry.
// These rules count such comparisons per file so the ratchet can only let them go down.

// One rule id per variant and per rule, so a fall in one variant's count can never pay for a rise in
// another: `architecture.variantLiteralDecision.agentProvider`, `...switchExhaustive.nodeKind`, ...
// Severity comes from the shared `variantRules.literalDecision` / `variantRules.switchExhaustive`.
export const VARIANT_RULE_BASE_IDS = {
  literalDecision: 'architecture.variantLiteralDecision',
  switchExhaustive: 'architecture.variantSwitchExhaustive',
}

export function variantRuleId(key, variantId) {
  return `${VARIANT_RULE_BASE_IDS[key]}.${variantId}`
}

const DEFAULT_ASSERT_NEVER_FILE = 'src/shared/utils/assertNever.ts'

const DEFAULT_DOC = 'docs/architecture/ARCHITECTURE.md#variants-and-registries'

export function collectVariantRuleSeverities(config) {
  const severities = new Map()
  const block = config.variantRules
  if (!block) {
    return severities
  }
  for (const key of Object.keys(VARIANT_RULE_BASE_IDS)) {
    for (const variant of block.variants ?? []) {
      severities.set(variantRuleId(key, variant.id), block[key]?.severity)
    }
  }
  return severities
}

export function assertVariantConfig(config) {
  const block = config.variantRules
  if (!block) {
    return
  }
  for (const key of Object.keys(VARIANT_RULE_BASE_IDS)) {
    const severity = block[key]?.severity
    if (severity !== 'warn' && severity !== 'error') {
      throw new Error(
        `variantRules.${key}.severity must be exactly "warn" or "error", got ${JSON.stringify(severity)}.`,
      )
    }
  }
  if (!Array.isArray(block.variants) || block.variants.length === 0) {
    throw new Error('variantRules.variants must be a non-empty array.')
  }
  const ids = new Set()
  for (const [index, variant] of block.variants.entries()) {
    const name = `variantRules.variants[${index}]`
    if (
      typeof variant.id !== 'string' ||
      !/^[A-Za-z0-9]+$/.test(variant.id) ||
      ids.has(variant.id)
    ) {
      throw new Error(
        `${name}.id must be a unique alphanumeric string (it is part of the rule id).`,
      )
    }
    ids.add(variant.id)
    if (typeof variant.source?.file !== 'string' || typeof variant.source?.export !== 'string') {
      throw new Error(`${name}.source must be {"file": string, "export": string}.`)
    }
    if (variant.subjectPattern !== undefined && variant.subjectPattern !== null) {
      try {
        const pattern = new RegExp(variant.subjectPattern, 'i')
        pattern.test('')
      } catch (error) {
        throw new Error(`${name}.subjectPattern is not a valid regular expression.`, {
          cause: error,
        })
      }
    }
  }
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function unwrapParentheses(node) {
  let current = node
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

function readStringArrayExport(sourceFile, exportName) {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) {
        continue
      }
      const initializer = declaration.initializer && unwrapExpression(declaration.initializer)
      if (
        !initializer ||
        !ts.isArrayLiteralExpression(initializer) ||
        !initializer.elements.every(element => ts.isStringLiteral(element))
      ) {
        return null
      }
      return initializer.elements.map(element => element.text)
    }
  }
  return null
}

// Reads every variant's literal set from the `as const` array it names. A missing file, a missing
// export or a non-literal export is an error: the rule must never silently check nothing.
export async function loadVariantSets({ root, config }) {
  const block = config.variantRules
  if (!block) {
    return []
  }
  return await Promise.all(
    block.variants.map(async variant => {
      const where = `variantRules.variants "${variant.id}" source ${variant.source.file}#${variant.source.export}`
      let text
      try {
        text = await readFile(resolve(root, variant.source.file), 'utf8')
      } catch (error) {
        throw new Error(`${where}: cannot read the source file (${error.code ?? error.message}).`, {
          cause: error,
        })
      }
      const sourceFile = ts.createSourceFile(
        variant.source.file,
        text,
        ts.ScriptTarget.Latest,
        true,
      )
      const literals = readStringArrayExport(sourceFile, variant.source.export)
      if (!literals || literals.length === 0) {
        throw new Error(
          `${where}: expected an exported array of string literals (\`as const\`), found none.`,
        )
      }
      for (const literal of Object.keys(variant.ownerGlobs ?? {})) {
        if (!literals.includes(literal)) {
          throw new Error(`${where}: ownerGlobs names "${literal}", which is not in the set.`)
        }
      }
      return {
        id: variant.id,
        literals: new Set(literals),
        ownerGlobs: variant.ownerGlobs ?? {},
        guardFiles: [variant.source.file, ...(variant.descriptorFiles ?? [])],
        subject: variant.subjectPattern ? new RegExp(variant.subjectPattern, 'i') : null,
        allowExitGuards: variant.allowExitGuards === true,
      }
    }),
  )
}

function isStringLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

// The final name of an expression: `a.b.kind` -> `kind`, `getKind(x)` -> `getKind`.
function finalName(node) {
  const expression = unwrapExpression(node)
  if (ts.isIdentifier(expression)) {
    return expression.text
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = unwrapExpression(expression.argumentExpression)
    return isStringLike(argument) ? argument.text : null
  }
  if (ts.isCallExpression(expression)) {
    return finalName(expression.expression)
  }
  return null
}

function subjectMatches(variant, subjectNode) {
  if (!variant.subject) {
    return true
  }
  const name = finalName(subjectNode)
  return name !== null && variant.subject.test(name)
}

function isOwned(variant, literal, relativePath, matches) {
  return (
    matches(relativePath, variant.guardFiles) ||
    matches(relativePath, variant.ownerGlobs[literal] ?? [])
  )
}

function onlyStatement(statement) {
  if (ts.isBlock(statement)) {
    return statement.statements.length === 1 ? statement.statements[0] : null
  }
  return statement
}

// "Existing value": a literal, `undefined`, an identifier, a chain of identifiers and `this`
// (`a.b.c`), or an empty array / object. Anything that computes (call, new, JSX, conditional,
// non-empty literal, template with substitutions, await, element access) is a decision.
function isExistingValue(expression) {
  const node = unwrapParentheses(expression)
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    ts.isIdentifier(node) ||
    node.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return true
  }
  if (ts.isPrefixUnaryExpression(node)) {
    return node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)
  }
  if (ts.isPropertyAccessExpression(node)) {
    return isPropertyChain(node)
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.length === 0
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.length === 0
  }
  return false
}

function isPropertyChain(node) {
  let current = node
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression
  }
  return ts.isIdentifier(current) || current.kind === ts.SyntaxKind.ThisKeyword
}

// A pure exit: `return;`, `return <existing value>`, `continue`, `break` or `throw ...`.
function isPureExit(statement) {
  const only = onlyStatement(statement)
  if (only === null) {
    return false
  }
  if (ts.isContinueStatement(only) || ts.isBreakStatement(only) || ts.isThrowStatement(only)) {
    return true
  }
  return ts.isReturnStatement(only) && (!only.expression || isExistingValue(only.expression))
}

function isSingleExitShape(statement) {
  const only = onlyStatement(statement)
  return (
    only !== null &&
    (ts.isReturnStatement(only) ||
      ts.isContinueStatement(only) ||
      ts.isBreakStatement(only) ||
      ts.isThrowStatement(only))
  )
}

function orOperands(expression) {
  const node = unwrapExpression(expression)
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ? [...orOperands(node.left), ...orOperands(node.right)]
    : [node]
}

// `!==` comparisons of guard shape: the whole condition, or one `||` operand, of an `if` with no
// `else` whose body is a single return, continue, break or throw. Maps each to whether the exit is
// pure; only pure exits are allowed, an exit that computes something is a per-variant decision.
function collectGuardShapes(sourceFile) {
  const guards = new Map()
  const visit = node => {
    if (ts.isIfStatement(node) && !node.elseStatement && isSingleExitShape(node.thenStatement)) {
      const pure = isPureExit(node.thenStatement)
      for (const operand of orOperands(node.expression)) {
        if (
          ts.isBinaryExpression(operand) &&
          operand.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
        ) {
          guards.set(operand, pure)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return guards
}

// Local names bound, by an import in this file, to the shared `assertNever` helper. A local function
// or an import of the same name from elsewhere is not the helper.
function collectAssertNeverNames(sourceFile, helperFile, resolveTarget) {
  const names = new Set()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !statement.importClause.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue
    }
    const bindings = statement.importClause.namedBindings.elements.filter(
      element =>
        !element.isTypeOnly && (element.propertyName ?? element.name).text === 'assertNever',
    )
    if (bindings.length > 0 && resolveTarget(statement.moduleSpecifier.text) === helperFile) {
      for (const element of bindings) {
        names.add(element.name.text)
      }
    }
  }
  return names
}

function isAssertNeverCall(expression, discriminantText, sourceFile, assertNeverNames) {
  const call = expression && unwrapExpression(expression)
  return (
    call !== undefined &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    assertNeverNames.has(call.expression.text) &&
    call.arguments.length >= 1 &&
    call.arguments[0].getText(sourceFile) === discriminantText
  )
}

// A switch is exhaustive when its last clause is `default:` and the first statement there proves
// the remaining type is `never`: `assertNever(x)` (also returned or thrown) or `const _: never = x`.
function isExhaustiveSwitch(switchStatement, sourceFile, assertNeverNames) {
  const clauses = switchStatement.caseBlock.clauses
  const last = clauses[clauses.length - 1]
  if (!last || !ts.isDefaultClause(last)) {
    return false
  }
  let statements = last.statements
  if (statements.length === 1 && ts.isBlock(statements[0])) {
    statements = statements[0].statements
  }
  const first = statements[0]
  if (!first) {
    return false
  }
  const discriminantText = switchStatement.expression.getText(sourceFile)
  if (ts.isExpressionStatement(first)) {
    return isAssertNeverCall(first.expression, discriminantText, sourceFile, assertNeverNames)
  }
  if (ts.isReturnStatement(first) || ts.isThrowStatement(first)) {
    return isAssertNeverCall(first.expression, discriminantText, sourceFile, assertNeverNames)
  }
  if (ts.isVariableStatement(first)) {
    return first.declarationList.declarations.some(
      declaration =>
        declaration.type?.kind === ts.SyntaxKind.NeverKeyword &&
        declaration.initializer !== undefined &&
        // Plain parentheses are fine; a cast (`as`, `satisfies`, `<T>x`, `!`) would defeat the proof.
        unwrapParentheses(declaration.initializer).getText(sourceFile) === discriminantText,
    )
  }
  return false
}

function shortText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120)
}

export function findVariantViolations({
  relativePath,
  filePath,
  source,
  config,
  variants,
  matches,
  resolveTarget,
}) {
  const block = config.variantRules
  if (!block || variants.length === 0) {
    return []
  }
  // Cheap pre-filter: skip the parse when the file mentions no literal of any variant.
  if (!variants.some(variant => [...variant.literals].some(literal => source.includes(literal)))) {
    return []
  }
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const guards = variants.some(variant => variant.allowExitGuards)
    ? collectGuardShapes(sourceFile)
    : new Map()
  const assertNeverNames = collectAssertNeverNames(
    sourceFile,
    block.assertNeverFile ?? DEFAULT_ASSERT_NEVER_FILE,
    resolveTarget,
  )
  const violations = []
  const lineOf = node =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const report = (key, variant, node, found, expected, message, extra = {}) => {
    violations.push({
      ruleId: variantRuleId(key, variant.id),
      severity: block[key].severity,
      file: relativePath,
      line: lineOf(node),
      message,
      found,
      expected,
      doc: block.doc ?? DEFAULT_DOC,
      variant: variant.id,
      ...extra,
    })
  }
  const literalFinding = (variant, literal, subject, node, guardShaped = false) => {
    if (!variant.literals.has(literal) || !subjectMatches(variant, subject)) {
      return
    }
    if (isOwned(variant, literal, relativePath, matches)) {
      return
    }
    report(
      'literalDecision',
      variant,
      node,
      shortText(node, sourceFile),
      `Do not branch on a ${variant.id} id. Add a field to the ${variant.id} registry entry and read it instead.`,
      `Decision made by comparing a ${variant.id} literal ("${literal}").`,
      guardShaped ? { guardShaped: true } : {},
    )
  }

  const visit = node => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
    ) {
      const left = unwrapExpression(node.left)
      const right = unwrapExpression(node.right)
      const leftLiteral = isStringLike(left)
      const rightLiteral = isStringLike(right)
      if (leftLiteral !== rightLiteral) {
        const literal = (leftLiteral ? left : right).text
        const subject = leftLiteral ? right : left
        for (const variant of variants) {
          const guardPure = guards.get(node)
          if (variant.allowExitGuards && guardPure === true) {
            continue
          }
          literalFinding(
            variant,
            literal,
            subject,
            node,
            variant.allowExitGuards && guardPure === false,
          )
        }
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'includes' &&
      node.arguments.length >= 1
    ) {
      const list = unwrapExpression(node.expression.expression)
      if (
        ts.isArrayLiteralExpression(list) &&
        list.elements.length > 0 &&
        list.elements.every(element => isStringLike(element))
      ) {
        for (const variant of variants) {
          const texts = list.elements.map(element => element.text)
          if (texts.every(text => variant.literals.has(text))) {
            // One finding per call; it is owned only when every listed literal is.
            const unowned = texts.find(text => !isOwned(variant, text, relativePath, matches))
            if (unowned !== undefined) {
              literalFinding(variant, unowned, node.arguments[0], node)
            }
          }
        }
      }
    } else if (ts.isSwitchStatement(node)) {
      const exhaustive = isExhaustiveSwitch(node, sourceFile, assertNeverNames)
      for (const variant of variants) {
        if (!subjectMatches(variant, node.expression)) {
          continue
        }
        const labels = node.caseBlock.clauses.filter(
          clause =>
            ts.isCaseClause(clause) &&
            isStringLike(unwrapExpression(clause.expression)) &&
            variant.literals.has(unwrapExpression(clause.expression).text),
        )
        if (labels.length === 0) {
          continue
        }
        const unowned = labels.filter(
          label =>
            !isOwned(variant, unwrapExpression(label.expression).text, relativePath, matches),
        )
        if (unowned.length === 0) {
          continue
        }
        if (!exhaustive) {
          report(
            'switchExhaustive',
            variant,
            node,
            `switch (${shortText(node.expression, sourceFile)})`,
            `End the switch with \`default: return assertNever(${shortText(node.expression, sourceFile)})\` so the compiler proves every ${variant.id} is handled, or read a registry field instead.`,
            `Switch over ${variant.id} ids is not exhaustive.`,
          )
          for (const label of unowned) {
            literalFinding(variant, unwrapExpression(label.expression).text, node.expression, label)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}
