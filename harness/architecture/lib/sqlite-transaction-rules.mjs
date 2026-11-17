import ts from 'typescript'

function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text
  }
  return undefined
}

function enclosingFunctionName(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) {
      return ts.isVariableDeclaration(parent.parent)
        ? parent.parent.name.getText()
        : parent.name?.getText()
    }
  }
  return undefined
}

export function sqliteTransactionViolations(file, source, rules) {
  if (!rules) {
    return []
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings = []
  function visit(node) {
    if (propertyName(node) === 'transaction') {
      const call = node.parent
      const directlyCalled = ts.isCallExpression(call) && call.expression === node
      const mode = directlyCalled ? propertyName(call.parent) : undefined
      const readOnly =
        directlyCalled &&
        rules.readOnly.some(
          entry => entry.file === file && entry.function === enclosingFunctionName(node),
        )
      if (!readOnly && mode !== 'immediate' && mode !== 'exclusive') {
        findings.push({
          ruleId: rules.id,
          severity: rules.severity,
          file,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          message: 'SQLite write transactions must acquire the write lock at BEGIN.',
          found: call.getText(ast),
          expected:
            'Select .immediate or .exclusive at transaction creation, or allowlist a read-only function.',
          doc: rules.doc,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return findings
}
