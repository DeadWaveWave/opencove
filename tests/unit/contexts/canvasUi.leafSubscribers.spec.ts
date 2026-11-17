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

/** The names a file imports from the store context, as exported (aliases and `type` removed). */
function namesImportedFromStoreContext(source: string): string[] {
  return [...source.matchAll(/import\s+\{([^}]*)\}\s*from\s*'[^']*\/canvasStoreContext'/g)].flatMap(
    match =>
      match[1]
        .split(',')
        .map(
          specifier =>
            specifier
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0],
        )
        .filter(Boolean),
  )
}

/**
 * The violations of the selector contract in `source`: every call of `useCanvasInteraction` (under
 * any local name) passes an identifier bound by a module-scope `const` arrow function of the same
 * file, and that arrow returns a field of the slice or a primitive, never a new object or array.
 * An inline function re-subscribes on every render; one that returns a new value loops.
 */
function selectorViolations(source: string, fileName = 'source.tsx'): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const localNames = new Set<string>()
  const moduleConsts = new Map<string, ts.Expression | undefined>()
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings) {
      const bindings = statement.importClause.namedBindings
      if (ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === 'useCanvasInteraction') {
            localNames.add(element.name.text)
          }
        }
      }
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          moduleConsts.set(declaration.name.text, declaration.initializer)
        }
      }
    }
  }

  const violations: string[] = []
  const forbidden = [
    ts.isBlock,
    ts.isObjectLiteralExpression,
    ts.isArrayLiteralExpression,
    ts.isNewExpression,
    ts.isCallExpression,
    ts.isArrowFunction,
    ts.isFunctionExpression,
  ]
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      localNames.has(node.expression.text)
    ) {
      const argument = node.arguments[0]
      const where = `${fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
      if (!argument || !ts.isIdentifier(argument)) {
        violations.push(`${where}: the selector is not an identifier bound at module scope`)
      } else {
        const initializer = moduleConsts.get(argument.text)
        if (!initializer || !ts.isArrowFunction(initializer)) {
          violations.push(`${where}: ${argument.text} is not a module-scope const arrow function`)
        } else {
          const offender = [initializer.body, ...flatten(initializer.body)].find(child =>
            forbidden.some(isForbidden => isForbidden(child)),
          )
          if (offender) {
            violations.push(
              `${where}: ${argument.text} returns a new value (${ts.SyntaxKind[offender.kind]})`,
            )
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return violations
}

function flatten(node: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = []
  ts.forEachChild(node, child => {
    nodes.push(child, ...flatten(child))
  })
  return nodes
}

// Decision 2 of #738: the subscribers of the `interaction` slice are leaves, and the host. They are
// the flow host (the live nodes and the node-drag preview), the snap guides overlay, the marquee
// rectangle and the context menu's snapping toggle. Hooks and WorkspaceCanvasInner read the slice
// at call time (`useReadCanvasInteraction`).
describe('canvas interaction subscriptions', () => {
  // By import, not by call text: a type argument (`useCanvasInteraction<boolean>(`) or an alias
  // (`import { useCanvasInteraction as use... }`) would hide a subscriber from a search for the
  // call. No hook and not WorkspaceCanvasInner imports it.
  it('only the host, the guides overlay, the draft overlay and the menus import useCanvasInteraction, under any name', () => {
    const importers = trackedSourceFiles().filter(file =>
      namesImportedFromStoreContext(readFileSync(file, 'utf8')).includes('useCanvasInteraction'),
    )

    expect(importers.map(file => file.slice(CANVAS_DIR.length)).sort()).toEqual(
      [FLOW_HOST, SNAP_GUIDES_OVERLAY, DRAFT_OVERLAY, CANVAS_MENUS].sort(),
    )
  })

  // A selector that is built in the call re-subscribes on every render, and one that returns a new
  // object or array is never equal to the last value and loops. The contract is a check, not a
  // comment: read from the syntax of every importer.
  it('every subscriber passes a module-scope selector that returns a stored value or a primitive', () => {
    const files = trackedSourceFiles().filter(file =>
      namesImportedFromStoreContext(readFileSync(file, 'utf8')).includes('useCanvasInteraction'),
    )
    expect(files.length).toBe(4)

    const violations = files.flatMap(file => selectorViolations(readFileSync(file, 'utf8'), file))

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
    ])('%s: %i violation(s)', (_name, body, count) => {
      const source = `${header}${body.replace(/\buse\(/g, 'useCanvasInteraction(')}`

      expect(selectorViolations(source)).toHaveLength(count)
    })

    it('follows an alias of the import', () => {
      const source =
        "import { useCanvasInteraction as useSlice } from '../store/canvasStoreContext'\nuseSlice(state => state.x)"

      expect(selectorViolations(source)).toHaveLength(1)
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
