import ts from 'typescript'

const sources = [
  {
    marker: '.command("update").alias("upgrade")',
    functions: [
      ['Fr', 'r'],
      ['Nn', 'n'],
      ['Hn', 'n'],
      ['Fn', 'n'],
    ],
  },
  { marker: 'export{q as registerPluginCommands}', functions: [['q', 'w']] },
  {
    marker: 'export{le as registerMcpCommands}',
    functions: [
      ['le', 'C'],
      ['T', 'C'],
    ],
  },
  { marker: 'function N2o(', functions: [['N2o', 'o']] },
]
function literal(node, source) {
  if (ts.isStringLiteral(node)) {
    return node.text
  }
  // Imported root command constant is defined in another source-pinned chunk.
  if (ts.isIdentifier(node) && node.text === 'ZBn') {
    const match = /\bvar ZBn="([^"]+)"/.exec(source)
    if (match) {
      return match[1]
    }
  }
  throw new Error(`Unverified command name: ${node.getText()}`)
}
export function registrationNames(expression) {
  const ast = ts.createSourceFile(
    'registration.js',
    expression,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const names = []
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      if (['command', 'alias'].includes(method)) {
        names.push(literal(node.arguments[0], expression).split(' ')[0])
      }
      if (method === 'aliases') {
        const arg = node.arguments[0]
        if (!ts.isArrayLiteralExpression(arg)) {
          throw new Error('Unverified root alias array')
        }
        names.push(...arg.elements.map(entry => literal(entry, expression)))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return names
}
export function extractClaudeRootRegistrations(source) {
  const records = []
  for (const spec of sources) {
    const at = source.indexOf(spec.marker)
    if (at < 0 || source.indexOf(spec.marker, at + 1) >= 0) {
      throw new Error(`Non-unique registry source: ${spec.marker}`)
    }
    const start = source.lastIndexOf('\0// @bun', at) + 1
    const end = source.indexOf('\0// @bun', at)
    const block = source.slice(start, end < 0 ? undefined : end)
    const lineBase = source.slice(0, start).split('\n').length
    const ast = ts.createSourceFile(
      'installed.js',
      block,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    )
    for (const [name, root] of spec.functions) {
      const declarations = []
      function find(node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
          declarations.push(node)
        }
        ts.forEachChild(node, find)
      }
      find(ast)
      if (declarations.length !== 1) {
        throw new Error(`Unverified registration function: ${name}`)
      }
      let count = 0
      function visit(node) {
        if (
          node !== declarations[0] &&
          ts.isFunctionLike(node) &&
          node.parameters.some(p => p.name.getText(ast) === root)
        ) {
          return
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'command' &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === root
        ) {
          const command = literal(node.arguments[0], source).split(' ')[0]
          let chain = node
          while (
            ts.isPropertyAccessExpression(chain.parent) &&
            ts.isCallExpression(chain.parent.parent) &&
            ['alias', 'aliases'].includes(chain.parent.name.text)
          ) {
            chain = chain.parent.parent
          }
          const expression = chain.getText(ast).replace(/\bZBn\b/g, JSON.stringify(command))
          records.push({
            owner: name,
            root,
            line: lineBase + ast.getLineAndCharacterOfPosition(node.getStart(ast)).line,
            expression,
          })
          count++
        }
        ts.forEachChild(node, visit)
      }
      visit(declarations[0])
      if (!count) {
        throw new Error(`Empty registration function: ${name}`)
      }
    }
  }
  return records
}
