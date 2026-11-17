import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const CANVAS_DIR = 'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/'
const CANVAS_STATE_HOOK = 'hooks/useCanvasState.ts'
const SPACE_OVERLAY = 'view/WorkspaceSpaceRegionsOverlay.tsx'
const REMOVED_NAMES = [
  'selectedSpaceIdsRef',
  'dragSelectedSpaceIdsRef',
  'setSelectedSpaceIds',
  'setSortedSelectedSpaceIds',
  'selectedNodeIdsRef',
  'setSelectedNodeIds',
]
const DRAFT_OVERLAY = 'view/WorkspaceSelectionDraftOverlay.tsx'
const CANVAS_MENUS = 'view/WorkspaceCanvasMenus.tsx'
const FLOW_HOST = 'CanvasFlowHost.tsx'
const SNAP_GUIDES_OVERLAY = 'view/WorkspaceSnapGuidesOverlay.tsx'
const STORE_DIR = 'src/contexts/workspace/presentation/renderer/store/'
const STORE_CONTEXT = `${STORE_DIR}canvasStoreContext.tsx`
const HOOKS_DIR = 'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/'

// Decision 7 of #685: only leaf components subscribe to the canvas `ui` slice. Hooks called by
// WorkspaceCanvasInner read it at call time (`useReadCanvasUi`) and write through commands.
describe('canvas UI subscriptions', () => {
  it('no hook under workspaceCanvas/hooks calls useCanvasUi', () => {
    const files = execFileSync('git', ['ls-files', HOOKS_DIR], { encoding: 'utf8' })
      .split('\n')
      .filter(file => /\.tsx?$/.test(file) && !/\.spec\./.test(file))
    expect(files.length).toBeGreaterThan(20)

    const offenders = files.filter(file => /\buseCanvasUi\(/.test(readFileSync(file, 'utf8')))

    expect(offenders).toEqual([])
  })

  // Decision 5 of #692: `useCanvasState` (nodeIds, for flowNodes) and the Space overlay
  // (spaceIds) are the only subscribers of the `selection` slice.
  // Scans every tracked source file, so a subscription in WorkspaceCanvasInner or anywhere else
  // fails too.
  it('useCanvasSelection is called only by useCanvasState and the Space overlay', () => {
    const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
      .split('\n')
      .filter(file => /\.tsx?$/.test(file) && !/\.(spec|test)\./.test(file))
    expect(files.length).toBeGreaterThan(1000)

    const callers = files.filter(file => /\buseCanvasSelection\(/.test(readFileSync(file, 'utf8')))

    expect(callers.map(file => file.slice(CANVAS_DIR.length)).sort()).toEqual(
      [CANVAS_STATE_HOOK, SPACE_OVERLAY].sort(),
    )
  })

  // `flowNodes` needs the node ids during render. A subscription to anything else in
  // `useCanvasState` (the Space ids, or the whole slice) would render WorkspaceCanvasInner on every
  // Space selection change.
  it('useCanvasState subscribes only to the selected node ids', () => {
    const source = readFileSync(`${CANVAS_DIR}${CANVAS_STATE_HOOK}`, 'utf8')

    const calls = source.match(/\buseCanvasSelection\(/g) ?? []
    const nodeIdCalls =
      source.match(/\buseCanvasSelection\(\s*(\w+)\s*=>\s*\1\.nodeIds\s*,?\s*\)/g) ?? []

    expect(calls).toHaveLength(1)
    expect(nodeIdCalls).toHaveLength(1)
  })

  it('no tracked source file under src names the removed selection refs and setters', () => {
    const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
      .split('\n')
      .filter(file => /\.(ts|tsx|mjs|css)$/.test(file))
    expect(files.length).toBeGreaterThan(500)

    const names = new RegExp(`\\b(${REMOVED_NAMES.join('|')})\\b`)
    const offenders = files.filter(file => names.test(readFileSync(file, 'utf8')))

    expect(offenders).toEqual([])
  })
})

function trackedSourceFiles(): string[] {
  const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
    .split('\n')
    .filter(file => /\.tsx?$/.test(file) && !/\.(spec|test)\./.test(file))
  expect(files.length).toBeGreaterThan(1000)
  return files
}

function parse(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, child => walk(child, visit))
}

/** The value exports of a module: functions, classes, variables and `export { }` names. */
function valueExports(file: ts.SourceFile): string[] {
  const names: string[] = []
  for (const statement of file.statements) {
    const exported = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      : false
    if (
      exported &&
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text)
    }
    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text)
        }
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) {
          names.push(element.name.text)
        }
      }
    }
  }
  return names.sort()
}

// What a selector may be built of: reads, comparisons and primitives. An allow-list: a deny-list
// lets tagged templates, JSX, class expressions and regular expressions through.
const SELECTOR_NODE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.BinaryExpression,
  ts.SyntaxKind.PrefixUnaryExpression,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.QuestionDotToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.QuestionToken,
  ts.SyntaxKind.ColonToken,
  ts.SyntaxKind.TypeReference,
  ts.SyntaxKind.UnknownKeyword,
])

/**
 * The violations of the selector contract in `source`: every call of `useCanvasInteraction` (under
 * any local name) passes an identifier that is the one binding of its name in the file, a
 * module-scope `const` arrow function whose parameters have no default and whose body is built
 * only of reads, comparisons and primitives (`SELECTOR_NODE_KINDS`). An inline function
 * re-subscribes on every render; a body that allocates renders its subscriber on every
 * notification, and loops when the selector is inline or the subscription is `useStore`.
 */
function selectorViolations(source: string, fileName = 'source.tsx'): string[] {
  const file = parse(source, fileName)
  const localNames = new Set<string>()
  const bindings = new Map<string, ts.Node[]>()
  const violations: string[] = []
  const where = (node: ts.Node) =>
    `${fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
  walk(file, node => {
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName ?? node.name).text === 'useCanvasInteraction'
    ) {
      localNames.add(node.name.text)
    }
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      bindings.set(node.name.text, [...(bindings.get(node.name.text) ?? []), node])
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'useCanvasInteraction') {
      violations.push(`${where(node)}: the hook is reached through a namespace`)
    }
  })

  walk(file, node => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      !localNames.has(node.expression.text)
    ) {
      return
    }
    const argument = node.arguments[0]
    const declarations =
      argument && ts.isIdentifier(argument) ? (bindings.get(argument.text) ?? []) : []
    const declaration = declarations[0]
    if (
      declarations.length !== 1 ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isVariableStatement(declaration.parent.parent) ||
      declaration.parent.parent.parent !== file ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      !declaration.initializer ||
      !ts.isArrowFunction(declaration.initializer)
    ) {
      violations.push(
        `${where(node)}: the selector is not the one module-scope const arrow of its name`,
      )
      return
    }
    const arrow = declaration.initializer
    if (arrow.parameters.some(parameter => parameter.initializer)) {
      violations.push(`${where(node)}: a parameter default allocates`)
    }
    walk(arrow.body, child => {
      if (!SELECTOR_NODE_KINDS.has(child.kind)) {
        violations.push(`${where(node)}: ${ts.SyntaxKind[child.kind]} in the selector`)
      }
    })
  })
  return violations
}

const SUBSCRIBERS = [FLOW_HOST, SNAP_GUIDES_OVERLAY, DRAFT_OVERLAY, CANVAS_MENUS].map(
  file => `${CANVAS_DIR}${file}`,
)

// Decision 2 of #738: the subscribers of the `interaction` slice are leaves, and the host. They are
// the flow host (the live nodes and the node-drag preview), the snap guides overlay, the marquee
// rectangle and the context menu's snapping toggle. Hooks and WorkspaceCanvasInner read the slice
// at call time (`useReadCanvasInteraction`). The rules are by symbol, not by import text.
describe('canvas interaction subscriptions', () => {
  // Any mention of the hook outside its definition and the four subscribers: an aliased import, a
  // namespace call (`context.useCanvasInteraction(`), a re-export from a barrel.
  it('names useCanvasInteraction only in the store context and the four subscribers', () => {
    const mentioning = trackedSourceFiles().filter(file => {
      let found = false
      walk(parse(readFileSync(file, 'utf8'), file), node => {
        if (ts.isIdentifier(node) && node.text === 'useCanvasInteraction') {
          found = true
        }
      })
      return found
    })

    expect(mentioning.sort()).toEqual([STORE_CONTEXT, ...SUBSCRIBERS].sort())
  })

  // A subscriber may not hand its subscription to someone else through an exported hook.
  it('the four subscribers export no hook', () => {
    const hooks = SUBSCRIBERS.flatMap(file =>
      valueExports(parse(readFileSync(file, 'utf8'), file))
        .filter(name => /^use[A-Z]/.test(name))
        .map(name => `${file}:${name}`),
    )

    expect(hooks).toEqual([])
  })

  // The store's api never leaves the context: a getter for it would let any file subscribe with
  // zustand's `useStore` (sync priority) or `api.subscribe`, and no text check would see it.
  it('the store context exports exactly its provider, readers, commands and subscriber hooks', () => {
    expect(valueExports(parse(readFileSync(STORE_CONTEXT, 'utf8'), STORE_CONTEXT))).toEqual(
      [
        'CanvasStoreProvider',
        'useCanvasDocumentCommands',
        'useCanvasInteraction',
        'useCanvasInteractionCommands',
        'useCanvasSelection',
        'useCanvasSelectionCommands',
        'useCanvasUi',
        'useCanvasUiCommands',
        'useReadCanvasDocument',
        'useReadCanvasInteraction',
        'useReadCanvasSelection',
        'useReadCanvasUi',
      ].sort(),
    )
  })

  it('every subscriber passes a module-scope selector made only of reads, comparisons and primitives', () => {
    const violations = SUBSCRIBERS.flatMap(file =>
      selectorViolations(readFileSync(file, 'utf8'), file),
    )

    expect(violations).toEqual([])
  })

  describe('the selector check itself', () => {
    const header = "import { useCanvasInteraction } from '../store/canvasStoreContext'\n"

    it.each([
      ['a module-scope field selector', 'const pick = (state) => state.liveNodes\nuse(pick)', 0],
      ['a nested field', 'const pick = (state) => state.a.b\nuse(pick)', 0],
      ['a comparison', 'const pick = (state) => state.a === null\nuse(pick)', 0],
      ['an inline arrow', 'use(state => state.liveNodes)', 1],
      ['an inline function', 'use(function (state) { return state.liveNodes })', 1],
      ['a selector from a call', 'use(makeSelector())', 1],
      ['an object result', 'const pick = (state) => ({ a: state.x })\nuse(pick)', 1],
      ['a block body', 'const pick = (state) => { return state.x }\nuse(pick)', 1],
      ['an array result', 'const pick = (state) => [state.x]\nuse(pick)', 1],
      ['a new instance', 'const pick = (state) => new Set(state.x)\nuse(pick)', 1],
      ['a call in the body', 'const pick = (state) => state.x.filter(Boolean)\nuse(pick)', 1],
      [
        'a selector declared in the component',
        'function C() { const pick = (s) => s.x; use(pick) }',
        1,
      ],
      ['a selector from a parameter', 'function C(pick) { use(pick) }', 1],
      ['a parameter default', 'const pick = (state, none = []) => state.x ?? none\nuse(pick)', 1],
      ['a coalesce with a field', 'const pick = (state) => state.x ?? state.y\nuse(pick)', 0],
      [
        'a selector shadowed in the component',
        'const pick = (s) => s.x\nfunction C() { const pick = (s) => s.x.slice(); use(pick) }',
        1,
      ],
      ['a tagged template', 'const pick = (state) => tag`x`\nuse(pick)', 1],
      ['a regular expression', 'const pick = (state) => /x/\nuse(pick)', 1],
      ['a let binding', 'let pick = (state) => state.x\nuse(pick)', 1],
      ['a namespace call', 'ctx.useCanvasInteraction(pick)', 1],
    ])('%s: %i (0 = accepted, 1 = violations)', (_name, body, count) => {
      const source = `${header}${body.replace(/\buse\(/g, 'useCanvasInteraction(')}`

      expect(selectorViolations(source).length > 0).toBe(count > 0)
    })

    it('follows an alias of the import', () => {
      const source =
        "import { useCanvasInteraction as useSlice } from '../store/canvasStoreContext'\nuseSlice(state => state.x)"

      expect(selectorViolations(source).length).toBeGreaterThan(0)
    })
  })

  // One hook decides the render priority of every subscriber (arm B of #738). A file that reached
  // the store another way would render its part of a frame in another lane than the nodes.
  it('no file outside the store context reaches the canvas store to subscribe to it', () => {
    const reachers = trackedSourceFiles().filter(file =>
      /\bcreateCanvasStore\b|\bCanvasStoreReadApi\b|^import\s+\{[^}]*\}\s+from\s+'[^']*\/canvasStore'/m.test(
        readFileSync(file, 'utf8'),
      ),
    )

    expect(reachers.sort()).toEqual([`${STORE_DIR}canvasStore.ts`, STORE_CONTEXT].sort())
  })

  // By primitive: `useStore` is `useSyncExternalStore`, sync priority, a frame earlier than arm B
  // renders. It may serve the `ui` and `selection` slices and nothing else, so a generic slice hook
  // added to the context (and used by a third leaf) fails here. The one `subscribe` call is the
  // arm B hook's.
  it('the store context subscribes with useStore only to ui and selection, and with subscribe once', () => {
    const source = readFileSync(STORE_CONTEXT, 'utf8')

    expect(source.match(/\buseStore\s*\(/g)).toHaveLength(2)
    expect(source.match(/\buseStore\(api, state => selector\(state\.(\w+)\)\)/g)).toEqual([
      'useStore(api, state => selector(state.ui))',
      'useStore(api, state => selector(state.selection))',
    ])
    expect(source.match(/\.subscribe\s*\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/\buseSyncExternalStore\s*\(/)
    expect(source.match(/export function useCanvasInteraction</g)).toHaveLength(1)
  })
})
