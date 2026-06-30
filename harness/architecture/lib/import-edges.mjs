import { extname } from 'node:path'
import ts from 'typescript'

function getScriptKind(filePath) {
  switch (extname(filePath)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function getLine(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function isTypeOnlyImportDeclaration(node) {
  const clause = node.importClause
  if (!clause) {
    return false
  }
  if (clause.isTypeOnly) {
    return true
  }
  if (clause.name) {
    return false
  }

  const bindings = clause.namedBindings
  return Boolean(
    bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every(element => element.isTypeOnly),
  )
}

function isTypeOnlyExportDeclaration(node) {
  if (node.isTypeOnly) {
    return true
  }

  const clause = node.exportClause
  return Boolean(
    clause &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every(element => element.isTypeOnly),
  )
}

function getStaticModuleSpecifierText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}

function getImportTypeModuleSpecifierText(node) {
  const argument = node.argument
  if (!ts.isLiteralTypeNode(argument)) {
    return null
  }
  return getStaticModuleSpecifierText(argument.literal)
}

export function readImportEdgesFromSource(filePath, source) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  )
  const edges = []

  const addEdge = (node, specifier, kind) => {
    edges.push({
      specifier,
      kind,
      line: getLine(sourceFile, node),
    })
  }

  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      const specifier = getStaticModuleSpecifierText(node.moduleSpecifier)
      if (!specifier) {
        ts.forEachChild(node, visit)
        return
      }
      addEdge(node, specifier, isTypeOnlyImportDeclaration(node) ? 'type' : 'runtime')
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = getStaticModuleSpecifierText(node.moduleSpecifier)
      if (specifier) {
        addEdge(node, specifier, isTypeOnlyExportDeclaration(node) ? 'type' : 'runtime')
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === 'require' &&
      node.arguments.length === 1
    ) {
      const specifier = getStaticModuleSpecifierText(node.arguments[0])
      if (specifier) {
        addEdge(node, specifier, 'runtime')
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1
    ) {
      const specifier = getStaticModuleSpecifierText(node.arguments[0])
      if (specifier) {
        addEdge(node, specifier, 'runtime')
      }
    }

    if (ts.isImportTypeNode(node)) {
      const specifier = getImportTypeModuleSpecifierText(node)
      if (specifier) {
        addEdge(node, specifier, 'type')
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return edges
}
