// Source scanner and rules behind `scripts/check-test-gates.mjs`. A test that runs on one platform
// only, a focused test (`.only`) and a test skipped without a condition each hide coverage: CI
// either never runs the test or runs less than it appears to. The scanner reads source with the
// TypeScript parser, so a string or a comment that mentions `test.only` never counts.
import ts from 'typescript'
import { compareRatchet, formatRatchetIssues, serializeRatchet } from './ratchet.mjs'

// Ratchet rule: skipped tests, frozen per file in `scripts/test-gates-ratchet.json`. The two hard
// rules (`platform-gate-suffix`, `focused-test`) have no baseline, they are 0.
export const TEST_GATES_RULES = ['unconditional-skip']

export const PLATFORMS = ['linux', 'darwin', 'win32']
// File-name suffix that marks a spec file as the home of tests for one platform. CI selects these
// files by glob (`**/*.windows.spec.*`, `**/*.mac.spec.*`), so a gate in an unsuffixed file would
// point at a platform where nothing runs it.
export const PLATFORM_SUFFIXES = { win32: '.windows.', darwin: '.mac.', linux: '.linux.' }
export const PLATFORM_SUFFIX_NAMES = { win32: 'windows', darwin: 'mac', linux: 'linux' }

const MAX_CONST_DEPTH = 8
const TEST_BASES = new Set([
  'test',
  'it',
  'describe',
  'test.describe',
  'test.describe.serial',
  'test.describe.parallel',
])
// Cheap pre-filter: a file that holds none of these cannot hold a gate, a focus or a skip.
const INTERESTING = /platform|\.only\b|\.skip|\.fixme|skipIf|runIf/

export function normalizeRepoPath(filePath) {
  return filePath.replaceAll('\\', '/')
}

/** `tests/**` TypeScript files (specs and their helpers) and `src/**` spec files. */
export function isTestGateSourcePath(filePath) {
  const path = normalizeRepoPath(filePath)
  if (!/\.tsx?$/.test(path) || /\.d\.ts$/.test(path)) {
    return false
  }
  return (
    path.startsWith('tests/') || (path.startsWith('src/') && /\.(?:spec|test)\.tsx?$/.test(path))
  )
}

/** A file that declares tests, as opposed to a helper that only exports functions. */
export function isSpecFilePath(filePath) {
  return /\.(?:spec|test)\.tsx?$/.test(normalizeRepoPath(filePath))
}

/** The platform a file name is reserved for (`foo.windows.spec.ts` is `win32`), or `null`. */
export function platformSuffixOf(filePath) {
  const name = normalizeRepoPath(filePath).split('/').pop() ?? ''
  for (const [platform, suffix] of Object.entries(PLATFORM_SUFFIXES)) {
    if (name.includes(suffix)) {
      return platform
    }
  }
  return null
}

function isLiteralText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

// Evaluates conditions on `process.platform`, following const declarations of the same file.
// Three-valued: `true`, `false`, or `undefined` for anything that cannot be decided from source.
function createEvaluator(sourceFile) {
  const constants = new Map()
  const collect = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      constants.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, collect)
  }
  collect(sourceFile)

  const isPlatformRead = node => node.getText(sourceFile) === 'process.platform'
  const stringOf = node => (isLiteralText(node) ? node.text : null)

  const evaluate = (node, platform, depth = 0) => {
    if (depth > MAX_CONST_DEPTH) {
      return undefined
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
      return evaluate(node.expression, platform, depth)
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
      return true
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
      return false
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const value = evaluate(node.operand, platform, depth)
      return value === undefined ? undefined : !value
    }
    if (ts.isIdentifier(node) && constants.has(node.text)) {
      return evaluate(constants.get(node.text), platform, depth + 1)
    }
    if (ts.isBinaryExpression(node)) {
      return evaluateBinary(node, platform, depth)
    }
    return undefined
  }

  const evaluateBinary = (node, platform, depth) => {
    const kind = node.operatorToken.kind
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = evaluate(node.left, platform, depth)
      const right = evaluate(node.right, platform, depth)
      if (left === false || right === false) {
        return false
      }
      return left === undefined || right === undefined ? undefined : true
    }
    if (kind === ts.SyntaxKind.BarBarToken) {
      const left = evaluate(node.left, platform, depth)
      const right = evaluate(node.right, platform, depth)
      if (left === true || right === true) {
        return true
      }
      return left === undefined || right === undefined ? undefined : false
    }
    const equal =
      kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken
    const unequal =
      kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsToken
    if (!equal && !unequal) {
      return undefined
    }
    let other = null
    if (isPlatformRead(node.left)) {
      other = stringOf(node.right)
    } else if (isPlatformRead(node.right)) {
      other = stringOf(node.left)
    }
    if (other === null) {
      return undefined
    }
    return equal ? platform === other : platform !== other
  }

  // The platforms on which `isRunning(platform)` holds, or `null` when the condition is unknown on
  // any of the three platforms.
  const platformsWhere = (condition, runsWhen) => {
    const values = PLATFORMS.map(platform => evaluate(condition, platform))
    if (values.some(value => value === undefined)) {
      return null
    }
    return PLATFORMS.filter((platform, index) => (runsWhen ? values[index] : !values[index]))
  }
  return { platformsWhere }
}

function isTitle(node) {
  return isLiteralText(node) || ts.isTemplateExpression(node)
}

function titleOf(node) {
  return isLiteralText(node) ? node.text : node.getText().slice(1, -1)
}

// `test.skip()`, `test.skip(true, ...)`, and `test.skip('title', body)`. A condition (`test.skip(cond,
// 'reason')`) is a gate, not a skip. A title with no body is not a declaration.
function isUnconditionalSkip(call) {
  const [first, ...rest] = call.arguments
  if (!first || first.kind === ts.SyntaxKind.TrueKeyword) {
    return true
  }
  return (
    isTitle(first) &&
    rest.some(
      argument =>
        ts.isArrowFunction(argument) ||
        ts.isFunctionExpression(argument) ||
        ts.isIdentifier(argument),
    )
  )
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function oneLine(text) {
  return text.replace(/\s+/g, ' ').slice(0, 100)
}

/**
 * Scans one file. Returns `{ gates, focused, skips, ignored }`:
 * - `gates`: tests that do not run on all three platforms, as `{ line, platforms, single, text }`.
 *   `platforms` is where the test runs; `single` is the one non-Linux platform it is restricted to,
 *   or `null`.
 * - `focused`: `.only` calls, as `{ line, text }`.
 * - `skips`: declarations skipped without a condition (`test.skip('title', fn)`, `test.skip()`,
 *   `test.skip(true, ...)`; also `describe`, `it`, `fixme`), as `{ line, title, text }`.
 * - `ignored`: conditions that mention a platform but could not be evaluated, as `{ line, text }`.
 */
export function scanTestSource(filePath, source) {
  const result = { gates: [], focused: [], skips: [], ignored: [] }
  if (!INTERESTING.test(source)) {
    return result
  }
  const kind = /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind)
  const { platformsWhere } = createEvaluator(sourceFile)

  const gate = (node, condition, runsWhen) => {
    const platforms = platformsWhere(condition, runsWhen)
    const line = lineOf(sourceFile, node)
    const text = oneLine(node.getText(sourceFile))
    if (platforms === null) {
      if (/platform/i.test(condition.getText(sourceFile))) {
        result.ignored.push({ line, text })
      }
      return
    }
    if (platforms.length === PLATFORMS.length) {
      return
    }
    const single = platforms.length === 1 && platforms[0] !== 'linux' ? platforms[0] : null
    result.gates.push({ line, platforms, single, text })
  }

  const visitCall = node => {
    const callee = node.expression
    if (!ts.isPropertyAccessExpression(callee)) {
      return
    }
    const name = callee.name.text
    const base = callee.expression.getText(sourceFile)
    const [first] = node.arguments
    if ((name === 'skipIf' || name === 'runIf') && first) {
      gate(node, first, name === 'runIf')
    } else if ((name === 'skip' || name === 'fixme') && TEST_BASES.has(base)) {
      if (isUnconditionalSkip(node)) {
        result.skips.push({
          line: lineOf(sourceFile, node),
          title: first && isTitle(first) ? titleOf(first) : '',
          text: oneLine(node.getText(sourceFile)),
        })
      } else if (first && !isTitle(first)) {
        gate(node, first, false)
      }
    } else if (name === 'only' && TEST_BASES.has(base)) {
      result.focused.push({
        line: lineOf(sourceFile, node),
        text: oneLine(node.getText(sourceFile)),
      })
    }
  }

  // `condition ? it : it.skip` and `condition ? it.skip : it`, for it, test and describe.
  const visitConditional = node => {
    const plain = /^(?:it|test|describe)$/
    const skipped = /^(?:it|test|describe)\.skip$/
    const whenTrue = node.whenTrue.getText(sourceFile)
    const whenFalse = node.whenFalse.getText(sourceFile)
    if (plain.test(whenTrue) && skipped.test(whenFalse)) {
      gate(node, node.condition, true)
    } else if (skipped.test(whenTrue) && plain.test(whenFalse)) {
      gate(node, node.condition, false)
    }
  }

  const visit = node => {
    if (ts.isCallExpression(node)) {
      visitCall(node)
    } else if (ts.isConditionalExpression(node)) {
      visitConditional(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return result
}

/**
 * Applies the hard rules to `files` (`[{ path, content }]`). `findings` are `{ file, line, rule,
 * message }` and fail the check; `counts` are the per-file ratchet counts and `skipLines` the lines
 * of each file's skip declarations; `totals` and `ignored`
 * are for the report.
 */
export function evaluateTestGates(files) {
  const findings = []
  const ignored = []
  const skipCounts = {}
  const skipLines = {}
  const totals = {
    files: 0,
    singlePlatformGates: 0,
    gatesInSuffixedFiles: 0,
    gatesInHelpers: 0,
    focused: 0,
    skips: 0,
  }
  for (const file of files) {
    const path = normalizeRepoPath(file.path)
    if (!isTestGateSourcePath(path)) {
      continue
    }
    totals.files += 1
    const scan = scanTestSource(path, file.content ?? '')
    const spec = isSpecFilePath(path)
    for (const gate of scan.gates) {
      if (!gate.single) {
        continue
      }
      totals.singlePlatformGates += 1
      if (!spec) {
        totals.gatesInHelpers += 1
      } else if (platformSuffixOf(path) === gate.single) {
        totals.gatesInSuffixedFiles += 1
      } else {
        const name = PLATFORM_SUFFIX_NAMES[gate.single]
        findings.push({
          file: path,
          line: gate.line,
          rule: 'platform-gate-suffix',
          message: `\`${gate.text}\` runs this test on ${gate.single} only. Move it to a file named *.${name}.spec.ts so the ${name} CI job runs it by glob.`,
        })
      }
    }
    for (const focus of scan.focused) {
      totals.focused += 1
      findings.push({
        file: path,
        line: focus.line,
        rule: 'focused-test',
        message: `\`${focus.text}\` focuses a test: every other test in the run is silently skipped. Remove \`.only\`.`,
      })
    }
    if (scan.skips.length > 0) {
      skipCounts[path] = scan.skips.length
      skipLines[path] = scan.skips.map(skip => skip.line)
      totals.skips += scan.skips.length
    }
    ignored.push(...scan.ignored.map(item => ({ file: path, ...item })))
  }
  return { findings, ignored, totals, counts: { 'unconditional-skip': skipCounts }, skipLines }
}

export function formatTestGateFindings(findings) {
  if (findings.length === 0) {
    return ''
  }
  const lines = [`[test-gates] ${findings.length} finding(s):`]
  for (const finding of findings) {
    lines.push(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`)
  }
  lines.push('', 'See "Test gates" in DEVELOPMENT.md.')
  return `${lines.join('\n')}\n`
}

// `skipLines` (`{ file: [line] }`) lets a rise name the declarations of the file that rose.
export function compareTestGatesRatchet(counts, baseline, skipLines = {}) {
  return compareRatchet({
    counts,
    baseline,
    rules: TEST_GATES_RULES,
    describe: (rule, now, before, file) => {
      if (now <= before) {
        return `${now} \`${rule}\` declaration(s), below the baseline of ${before}. Run \`pnpm test-gates:ratchet\` and commit \`scripts/test-gates-ratchet.json\` to lock in the improvement.`
      }
      const lines = skipLines[file] ?? []
      const where =
        lines.length > 0 ? ` (line${lines.length > 1 ? 's' : ''} ${lines.join(', ')})` : ''
      return `${now} \`${rule}\` declaration(s)${where}, ${now - before} more than the baseline of ${before}. Run the test, fix it or delete it instead of skipping it.`
    },
  })
}

export function formatTestGatesRatchetIssues(issues) {
  return formatRatchetIssues(issues, {
    label: 'test-gates',
    title: 'Unconditional skip ratchet',
    footer: 'See "Test gates" in DEVELOPMENT.md.',
  })
}

export function serializeTestGatesRatchet(counts) {
  return serializeRatchet(counts, TEST_GATES_RULES)
}
