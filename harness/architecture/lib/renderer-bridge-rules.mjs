import ts from 'typescript'

/** Deliberately bounded syntax rule: property names, aliases and literal exposure seams. */
export function rendererBridgeViolations(file, source, rules) {
  if (!rules) {
    return []
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings = []
  const client = rules.clients.includes(file)
  const preload = file.startsWith('src/app/preload/')
  const renderer = file.includes('/renderer/')
  function report(node, message) {
    findings.push({
      ruleId: rules.id,
      severity: rules.severity,
      file,
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
      message,
      found: node.getText(ast),
      expected: 'Keep raw transport and private diagnostics inside the approved boundary adapters.',
      doc: rules.doc,
    })
  }
  const constants = new Map()
  function collect(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      constants.set(node.name.text, node.initializer.text)
    }
    ts.forEachChild(node, collect)
  }
  collect(ast)
  const text = node =>
    !node
      ? undefined
      : ts.isStringLiteralLike(node)
        ? node.text
        : ts.isIdentifier(node)
          ? (constants.get(node.text) ?? node.text)
          : undefined
  function visit(node) {
    const property = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && node.argumentExpression
        ? text(node.argumentExpression)
        : ts.isBindingElement(node)
          ? text(node.propertyName ?? node.name)
          : undefined
    if (property === '__opencoveBridge' && !client && !preload) {
      report(node, 'Raw Desktop bridge access outside the client.')
    }
    if (property === '__opencoveRendererBridge' && renderer && !client) {
      report(node, 'Raw bridge envelopes belong to the Desktop client.')
    }
    if (
      preload &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = node.left
      const name = ts.isPropertyAccessExpression(left)
        ? left.name.text
        : ts.isElementAccessExpression(left)
          ? text(left.argumentExpression)
          : undefined
      if (name === 'opencoveApi') {
        report(node, 'Preload must not expose the public facade.')
      }
      if (name === '__opencoveBridge' && node.right.getText(ast) !== 'rendererBridge') {
        report(node, 'Fallback exposure must use the adapted transport.')
      }
    }
    if (
      renderer &&
      ts.isImportSpecifier(node) &&
      text(node.propertyName ?? node.name) === 'getAppErrorDebugMessage'
    ) {
      report(node, 'Renderer code must not import the private diagnostic reader.')
    }
    if (
      property === 'exposeInMainWorld' &&
      (!ts.isCallExpression(node.parent) || node.parent.expression !== node)
    ) {
      report(node, 'Keep transport exposure at a direct, auditable call site.')
    }
    if (property === 'debugMessage' && renderer) {
      report(node, 'Renderer code must not read private diagnostic text.')
    }
    if (
      ts.isStringLiteralLike(node) &&
      node.text === '__opencoveRendererBridge' &&
      renderer &&
      !client
    ) {
      report(node, 'Raw bridge envelopes belong to the Desktop client.')
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'exposeInMainWorld'
    ) {
      if (
        !preload ||
        text(node.arguments[0]) !== '__opencoveBridge' ||
        !ts.isIdentifier(node.arguments[1])
      ) {
        report(node, 'Expose only the adapted Desktop transport.')
      } else {
        const name = node.arguments[1].text
        const declarations = ast.statements
          .filter(ts.isVariableStatement)
          .flatMap(statement => [...statement.declarationList.declarations])
        const declaration = declarations.find(
          item => ts.isIdentifier(item.name) && item.name.text === name,
        )
        if (
          !declaration?.initializer ||
          !ts.isCallExpression(declaration.initializer) ||
          declaration.initializer.expression.getText(ast) !== 'createRendererBridge'
        ) {
          report(node, 'Exposure must use createRendererBridge.')
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return findings
}
