import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Invariant 1 of #702 (S5 of #647): outside the files listed here, canvas code reads committed
// nodes and Spaces through `useReadCanvasDocument()` and writes Spaces through
// `useCanvasDocumentCommands()`. Each pull request of the slice shrinks these lists; a file that
// names one of the retired channels again, or a file that no longer does but is still listed,
// fails. `~/` stands for the workspaceCanvas component directory.
const CANVAS_DIR = 'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/'

// The end of the slice (#702, PR 14) and of the node store's mirror (#738, PR 4). `nodesRef` is
// left only in `WorkspacePixelLayer.tsx`, where it is a local ref of that component's own `nodes`
// prop (S9's floor). `spacesRef` and `onSpacesChange` are gone. The `onRequestPersistFlush` that
// remains is not the canvas's: the quit flush subscription of the preload bridge and its browser
// stand-in, and the shell's quit handler. The names after it are retired by #738: no file names
// them again.
const ALLOWED_FILES: Record<string, readonly string[]> = {
  // Retired by S7 (PR 8): the node store returns no writer, and every consumer takes it from
  // `useCanvasNodeWriter()`. What is left is the plugin preview's own `useState` setter, which is
  // not the canvas's.
  setNodes: ['src/contexts/plugins/presentation/renderer/PluginRuntimePreview.tsx'],
  nodesRef: ['~/view/WorkspacePixelLayer.tsx'],
  spacesRef: [],
  onSpacesChange: [],
  onRequestPersistFlush: [
    'src/app/preload/api.d.ts',
    'src/app/preload/index.ts',
    'src/app/renderer/browser/browserOpenCoveApi.ts',
    'src/app/renderer/shell/hooks/useAppQuitPersistenceFlush.ts',
  ],
  isLiveGestureActive: [],
  onNodesCommitted: [],
  publishCommittedNodes: [],
  resolveCanvasDocumentBase: [],
  // Retired by S7 (PR 2): it wrote the dragged windows' `selected` mirror into the document one
  // frame after a drop, which the canvas view never read.
  restoreSelectionAfterDrop: [],
  // Retired by S7 (PR 3): the change path writes a recipe of removals and settled positions.
  replaceWorkspaceNodes: [],
  // Retired by S7 (PR 7): the bag of action refs and its 30 refs, and the types that carried them
  // while the families moved to commands. A node component reads `useCanvasNodeCommands()`.
  closeNodeRef: [],
  clearNodeSelectionRef: [],
  resizeNodeRef: [],
  normalizeViewportForTerminalInteractionRef: [],
  requestNodeDeleteRef: [],
  updateNoteTextRef: [],
  renameNoteTitleRef: [],
  updateWebsiteUrlRef: [],
  setWebsitePinnedRef: [],
  setWebsiteSessionRef: [],
  setWebsiteModeRef: [],
  setWebsiteFullscreenRef: [],
  copyAgentLastMessageRef: [],
  reloadAgentSessionRef: [],
  listAgentSessionsRef: [],
  switchAgentSessionRef: [],
  updateNodeScrollbackRef: [],
  updateTerminalTitleRef: [],
  clearTerminalAgentOverlayRef: [],
  renameTerminalTitleRef: [],
  updateRoleInputRef: [],
  updateRoleProviderRef: [],
  runRoleRef: [],
  runTaskAgentRef: [],
  resumeTaskAgentSessionRef: [],
  removeTaskAgentSessionRecordRef: [],
  openTaskEditorRef: [],
  quickUpdateTaskTitleRef: [],
  quickUpdateTaskRequirementRef: [],
  updateTaskStatusRef: [],
  WorkspaceCanvasActionRefs: [],
  useWorkspaceCanvasActionRefs: [],
  TransitionalNodeActionRefs: [],
  WiredCanvasNodeCommands: [],
}

function trackedSourceFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
    .split('\n')
    .filter(file => /\.tsx?$/.test(file) && !/\.(spec|test)\./.test(file))
}

function expand(files: readonly string[]): string[] {
  return files.map(file => (file.startsWith('~/') ? CANVAS_DIR + file.slice(2) : file)).sort()
}

describe('canvas document channels', () => {
  const files = trackedSourceFiles()
  const sources = new Map(files.map(file => [file, readFileSync(file, 'utf8')]))
  const source = (file: string) => sources.get(file) ?? ''

  it('scans the whole source tree', () => {
    expect(files.length).toBeGreaterThan(1000)
  })

  it.each(Object.keys(ALLOWED_FILES))('%s appears only in the files that still own it', name => {
    const pattern = new RegExp(`\\b${name}\\b`)
    const holders = files.filter(file => pattern.test(sources.get(file) ?? '')).sort()

    expect(holders).toEqual(expand(ALLOWED_FILES[name]))
  })

  // The reader lets a hook read the committed document when it runs, without subscribing. A file
  // that reads through it and also subscribes to the app store would render with every store
  // change, which the move from the refs must not bring. A render-time test cannot see it: the
  // subscription is made at mount. The check looks at the import, so an alias or a store read
  // through `useStore` or `useSyncExternalStore` cannot slip past it; such a file has no reason to
  // import the app store at all.
  it('no file that reads through useReadCanvasDocument imports the app store or subscribes', () => {
    const readers = files.filter(file =>
      /\buseReadCanvasDocument\(\)/.test(sources.get(file) ?? ''),
    )
    expect(readers.length).toBeGreaterThan(20)

    const offenders = readers.filter(file =>
      /from\s+['"][^'"]*\/useAppStore['"]|\buseSyncExternalStore\b/.test(sources.get(file) ?? ''),
    )

    expect(offenders).toEqual([])
  })

  // The node types read the Spaces when they render and must not subscribe to them: a
  // subscription would render every task card on each node commit, because sanitizing makes a new
  // Spaces array. They read through the reader themselves, so the check above covers them; this
  // case fails if a rewrite takes the reader out of those files and with it the check.
  it('the node type files that read Spaces are among the files checked for a subscription', () => {
    const readers = files.filter(file =>
      /\buseReadCanvasDocument\(\)/.test(sources.get(file) ?? ''),
    )

    expect(readers).toEqual(
      expect.arrayContaining([`${CANVAS_DIR}nodeTypes.tsx`, `${CANVAS_DIR}nodeTypes.task.tsx`]),
    )
  })

  // A hook that is handed a reader instead of calling `useReadCanvasDocument()` is outside the
  // check above, so an app store subscription added there would go unseen. The only such files with
  // an app store import are the role actions, which select the settings setter and nothing else,
  // and the plugin window creation, which only calls `useAppStore.getState()` in a handler and is
  // handed the reader by the node creation hook because this check bars it from creating one.
  it('files handed a document reader subscribe to nothing in the app store but the role settings setter', () => {
    const handed = files.filter(file =>
      /\breadDocument\??:\s*\(\)\s*=>\s*WorkspaceDocument\b/.test(source(file)),
    )
    expect(handed.length).toBeGreaterThan(2)
    const appStoreUses = Object.fromEntries(
      handed
        .filter(file =>
          /\/useAppStore['"]|\buseSyncExternalStore\b|\buseStore\b/.test(source(file)),
        )
        .map(file => [
          file,
          // Every use of the app store but `useAppStore.getState()` (a call selects its argument),
          // and every other subscription, whatever it subscribes to.
          [
            ...source(file)
              .replace(/^import .*$/gm, '')
              .matchAll(
                /\buseAppStore\b(?!\.getState\b)(?:\(([^)]*)\))?|\buseSyncExternalStore\s*\(|\buseStore\s*\(/g,
              ),
          ].map(match => (match[1] ?? match[0]).trim()),
        ]),
    )
    expect(appStoreUses).toEqual({
      [`${CANVAS_DIR}hooks/useNodesStore.createPluginNode.ts`]: [],
      [`${CANVAS_DIR}hooks/useRoleActions.ts`]: ['state => state.setAgentSettings'],
    })
  })
})

// Decision 7 and 8 of S7 (#647): a hook gets the node writer from `useCanvasNodeWriter()`, not as a
// parameter. Plain (non-hook) action functions keep taking it. The hooks that declared one were
// listed; each pull request of the slice shortened the list, and PR 9 left it empty. The check
// reads what a hook declares, not what it is called: a parameter, a property of a destructured
// parameter (under whatever local name), a property read from an object parameter (`props.x`,
// `nodeStore.x` on a destructured `nodeStore`, `const { x } = props`), a member of a parameter type
// (inline, or an interface or alias of the same file, with its `extends`), or a parameter type that
// names a writer: `Store['setNodes']`, `Pick<Store, 'setNodes'>`, `CanvasNodeWriter`,
// `UpdateCanvasDocument`, `ReturnType<typeof useCanvasNodeWriter>`. So
// `const write = props.updateCanvasDocument`, `{ updateCanvasDocument: write }` and
// `write: CanvasNodeWriter['updateNodes']` are caught like `updateCanvasDocument`.
const WRITER_NAMES = new Set(['setNodes', 'updateNodes', 'updateCanvasDocument'])

function isHookName(name: string | undefined): name is string {
  return name !== undefined && /^use[A-Z0-9]/.test(name)
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) {
    return null
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return null
}

/** The writer names a parameter of a hook declares, by its name, its pattern or its type. */
function declaredWriterNames(
  parameter: ts.ParameterDeclaration,
  localTypes: ReadonlyMap<string, ts.Node>,
): string[] {
  const found = new Set<string>()
  const check = (name: string | null) => {
    if (name !== null && WRITER_NAMES.has(name)) {
      found.add(name)
    }
  }
  const visitPattern = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) {
      return
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue
      }
      if (ts.isObjectBindingPattern(name)) {
        // `{ updateCanvasDocument: write }` declares the property `updateCanvasDocument`.
        check(propertyNameText(element.propertyName ?? element.name))
      }
      visitPattern(element.name)
    }
  }
  if (ts.isIdentifier(parameter.name)) {
    check(parameter.name.text)
  } else {
    visitPattern(parameter.name)
  }
  const visited = new Set<ts.Node>()
  const visitType = (node: ts.Node) => {
    if (visited.has(node)) {
      return
    }
    visited.add(node)
    if (ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
      check(propertyNameText(node.name))
    }
    // `Store['setNodes']` and `Pick<Store, 'setNodes' | ...>` name the writer in a literal type.
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      check(node.literal.text)
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      if (node.typeName.text === 'CanvasNodeWriter') {
        found.add('updateNodes')
        found.add('updateCanvasDocument')
      }
      // The exported alias of the writer's document write (S7 PR 8).
      if (node.typeName.text === 'UpdateCanvasDocument') {
        found.add('updateCanvasDocument')
      }
      // A parameter typed by an interface or alias of the same file: its members are declared too.
      const declaration = localTypes.get(node.typeName.text)
      if (declaration) {
        visitType(declaration)
      }
    }
    // `ReturnType<typeof useCanvasNodeWriter>` is the writer too.
    if (
      ts.isTypeQueryNode(node) &&
      ts.isIdentifier(node.exprName) &&
      node.exprName.text === 'useCanvasNodeWriter'
    ) {
      found.add('updateNodes')
      found.add('updateCanvasDocument')
    }
    // `interface P extends Q`, with `Q` of the same file.
    if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) {
      const declaration = localTypes.get(node.expression.text)
      if (declaration) {
        visitType(declaration)
      }
    }
    ts.forEachChild(node, visitType)
  }
  if (parameter.type) {
    visitType(parameter.type)
  }
  return [...found]
}

/**
 * The hooks (`use*` functions) of `source` that declare a node writer parameter, as `name` or
 * `name:parameterWriterName`. Reads of `props.updateCanvasDocument` on an identifier parameter
 * count as a declaration.
 */
function hooksDeclaringWriterParameters(source: string, fileName = 'source.ts'): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const hooks: string[] = []
  const localTypes = new Map<string, ts.Node>()
  for (const statement of file.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      localTypes.set(statement.name.text, statement)
    }
  }
  const inspect = (hookName: string, fn: ts.SignatureDeclaration & { body?: ts.Node }) => {
    const names = new Set<string>()
    const objectParameters = new Set<string>()
    // Every identifier a parameter binds is an object parameter: `nodeStore` in `{ nodeStore }`.
    const bindNames = (name: ts.BindingName) => {
      if (ts.isIdentifier(name)) {
        objectParameters.add(name.text)
        return
      }
      for (const element of name.elements) {
        if (!ts.isOmittedExpression(element)) {
          bindNames(element.name)
        }
      }
    }
    for (const parameter of fn.parameters) {
      declaredWriterNames(parameter, localTypes).forEach(name => names.add(name))
      bindNames(parameter.name)
    }
    if (fn.body) {
      const read = (node: ts.Node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          objectParameters.has(node.expression.text) &&
          WRITER_NAMES.has(node.name.text)
        ) {
          names.add(node.name.text)
        }
        if (
          ts.isElementAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          objectParameters.has(node.expression.text) &&
          ts.isStringLiteralLike(node.argumentExpression) &&
          WRITER_NAMES.has(node.argumentExpression.text)
        ) {
          names.add(node.argumentExpression.text)
        }
        // `const { setNodes } = nodeStore` in the body.
        if (
          ts.isVariableDeclaration(node) &&
          ts.isObjectBindingPattern(node.name) &&
          node.initializer &&
          ts.isIdentifier(node.initializer) &&
          objectParameters.has(node.initializer.text)
        ) {
          for (const element of node.name.elements) {
            const name = propertyNameText(element.propertyName ?? element.name)
            if (name !== null && WRITER_NAMES.has(name)) {
              names.add(name)
            }
          }
        }
        ts.forEachChild(node, read)
      }
      read(fn.body)
    }
    for (const name of [...names].sort()) {
      hooks.push(`${hookName}:${name}`)
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && isHookName(node.name?.text)) {
      inspect(node.name!.text, node)
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isHookName(node.name.text) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      inspect(node.name.text, node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hooks.sort()
}

// The hooks under the renderer tree that take the node writer as a parameter, as
// `<file>#<hook>:<name>` (`~/` stands for `workspaceCanvas/`). S7 PR 9 emptied the list: every hook takes the writer from
// `useCanvasNodeWriter()` (or `useCanvasDocumentCommands()`), so a parameter cannot come back.
// Do not add a line.
const HOOKS_WITH_WRITER_PARAMETERS: readonly string[] = []

const RENDERER_DIR = 'src/contexts/workspace/presentation/renderer/'

describe('hooks do not take the node writer as a parameter', () => {
  const canvasFiles = trackedSourceFiles().filter(file => file.startsWith(RENDERER_DIR))

  it('flags a parameter, a destructured property, an alias and an inline type', () => {
    const flagged = (source: string) => hooksDeclaringWriterParameters(source)

    expect(flagged('export function useA(setNodes: Fn) {}')).toEqual(['useA:setNodes'])
    expect(flagged('export function useA({ updateNodes }: P) {}')).toEqual(['useA:updateNodes'])
    expect(flagged('export function useA({ updateCanvasDocument: write }: P) {}')).toEqual([
      'useA:updateCanvasDocument',
    ])
    expect(flagged('export function useA({ a: { setNodes: write } }: P) {}')).toEqual([
      'useA:setNodes',
    ])
    expect(
      flagged('export function useA(props: P) { const write = props.updateCanvasDocument }'),
    ).toEqual(['useA:updateCanvasDocument'])
    expect(flagged("export function useA(props: P) { props['setNodes'](x) }")).toEqual([
      'useA:setNodes',
    ])
    expect(flagged('export function useA(p: { setNodes: Fn; other: number }) {}')).toEqual([
      'useA:setNodes',
    ])
    // A parameter typed by an interface or alias of the same file declares its members.
    expect(flagged('interface P { updateNodes: Fn }\nexport function useA(p: P) {}')).toEqual([
      'useA:updateNodes',
    ])
    expect(flagged('type P = { setNodes: Fn }\nexport function useA(p: P) {}')).toEqual([
      'useA:setNodes',
    ])
    // A parameter that is renamed but typed as the writer, or names it in a literal type.
    expect(flagged("export function useA(write: CanvasNodeWriter['updateNodes']) {}")).toEqual([
      'useA:updateCanvasDocument',
      'useA:updateNodes',
    ])
    expect(flagged("export function useA({ commit }: { commit: Store['setNodes'] }) {}")).toEqual([
      'useA:setNodes',
    ])
    expect(flagged('export function useA(write: UpdateCanvasDocument) {}')).toEqual([
      'useA:updateCanvasDocument',
    ])
    expect(
      flagged('export function useA(writer: ReturnType<typeof useCanvasNodeWriter>) {}'),
    ).toEqual(['useA:updateCanvasDocument', 'useA:updateNodes'])
    expect(flagged('export function useA(writer: CanvasNodeWriter) {}')).toEqual([
      'useA:updateCanvasDocument',
      'useA:updateNodes',
    ])
    expect(
      flagged("type P = Pick<Store, 'updateCanvasDocument'>\nexport function useA(p: P) {}"),
    ).toEqual(['useA:updateCanvasDocument'])
    expect(
      flagged(
        'interface Q { setNodes: Fn }\ninterface P extends Q {}\nexport function useA(p: P) {}',
      ),
    ).toEqual(['useA:setNodes'])
    // A writer inside an object parameter that the hook destructures or reads.
    expect(
      flagged('export function useA({ nodeStore }: P) { const { setNodes } = nodeStore }'),
    ).toEqual(['useA:setNodes'])
    expect(
      flagged('export function useA({ nodeStore }: P) { nodeStore.updateCanvasDocument(x) }'),
    ).toEqual(['useA:updateCanvasDocument'])
    expect(flagged('export function useA(props: P) { const { setNodes } = props }')).toEqual([
      'useA:setNodes',
    ])
    expect(flagged('export const useA = ({ updateNodes }: P) => {}')).toEqual(['useA:updateNodes'])
    expect(flagged('export const useA = function ({ setNodes }: P) {}')).toEqual(['useA:setNodes'])
    expect(flagged('function outer() { function useA(setNodes: Fn) {} }')).toEqual([
      'useA:setNodes',
    ])
  })

  // The shapes the first version of the check missed (found in review) and that the hooks of PR 9
  // used: the writer inside an options object that the hook reads or destructures.
  it('flags the writer that a hook receives inside an options object', () => {
    const flagged = (source: string) => hooksDeclaringWriterParameters(source)

    expect(
      flagged(
        'interface Options { updateCanvasDocument: UpdateCanvasDocument }\n' +
          'export function useA(options: Options) { const write = options.updateCanvasDocument }',
      ),
    ).toEqual(['useA:updateCanvasDocument'])
    expect(flagged('export function useA({ setNodes, other }: Options) {}')).toEqual([
      'useA:setNodes',
    ])
  })

  it('does not flag what Decision 8 allows', () => {
    const flagged = (source: string) => hooksDeclaringWriterParameters(source)

    // A plain action function takes the writer explicitly.
    expect(flagged('export function runAction({ updateNodes }: P) {}')).toEqual([])
    expect(flagged('export const apply = (setNodes: Fn) => {}')).toEqual([])
    // A hook takes it from the context, under whatever local name.
    expect(
      flagged('export function useA() { const { updateNodes: setNodes } = useCanvasNodeWriter() }'),
    ).toEqual([])
    // A callback inside a hook is not the hook's parameter.
    expect(flagged('export function useA() { return (setNodes: Fn) => setNodes(x) }')).toEqual([])
    // Another property of the same parameter.
    expect(flagged('export function useA(props: P) { return props.other }')).toEqual([])
  })

  it('finds no hook under the renderer tree that declares one', () => {
    expect(canvasFiles.length).toBeGreaterThan(300)

    const declared = canvasFiles.flatMap(file =>
      hooksDeclaringWriterParameters(readFileSync(file, 'utf8'), file).map(
        hook =>
          `${file.startsWith(CANVAS_DIR) ? `~/${file.slice(CANVAS_DIR.length)}` : file}#${hook}`,
      ),
    )

    expect(declared.sort()).toEqual([...HOOKS_WITH_WRITER_PARAMETERS].sort())
  })
})

// Decision 7 of S7 (#647), Invariant 1: the document holds no canvas-only field. `selected`,
// `dragHandle` and `dragging` exist only in the view handed to React Flow, which two files derive
// from committed nodes: the decoration and the live overlay (`canvasLiveNodes.ts`) and the
// collapse projection (`canvasCollapse.ts`). An object literal that spreads an object and sets one
// of the three is how such a field gets copied onto a node, so it may appear nowhere else.
const CANVAS_ONLY_FIELDS = new Set(['selected', 'dragHandle', 'dragging'])
const RENDERER_UTILS_DIR = 'src/contexts/workspace/presentation/renderer/utils/'
const CANVAS_VIEW_FILES = [
  `${RENDERER_UTILS_DIR}canvasCollapse.ts`,
  `${RENDERER_UTILS_DIR}canvasLiveNodes.ts`,
]

/** The canvas-only fields that object literals of `source` set next to a spread. */
function canvasOnlyFieldsSetBySpreadLiterals(source: string, fileName = 'source.ts'): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const found = new Set<string>()
  const visit = (node: ts.Node) => {
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(property => ts.isSpreadAssignment(property))
    ) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const name = propertyNameText(property.name)
          if (name !== null && CANVAS_ONLY_FIELDS.has(name)) {
            found.add(name)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...found].sort()
}

describe('canvas-only fields are set only where the view is derived', () => {
  it('flags a spread literal that sets one, however it is written', () => {
    const flagged = (source: string) => canvasOnlyFieldsSetBySpreadLiterals(source)

    expect(flagged('const a = { ...node, selected: true }')).toEqual(['selected'])
    expect(flagged('const a = { ...node, dragHandle: existing.dragHandle }')).toEqual([
      'dragHandle',
    ])
    expect(flagged('const a = { ...node, ...(x ? { dragging: true } : {}), dragging }')).toEqual([
      'dragging',
    ])
    expect(flagged("const a = { ...node, 'selected': false, dragging }")).toEqual([
      'dragging',
      'selected',
    ])
    expect(flagged('const a = { ...node, selected }')).toEqual(['selected'])
    // The spread need not come first.
    expect(flagged('const a = { selected: true, ...node }')).toEqual(['selected'])
  })

  it('does not flag a literal that cannot copy a field onto a node', () => {
    const flagged = (source: string) => canvasOnlyFieldsSetBySpreadLiterals(source)

    // No spread: a fixture or a record of its own, not a node carried forward.
    expect(flagged('const a = { selected: true, id }')).toEqual([])
    // A spread with other fields, and reading the fields.
    expect(flagged('const a = { ...node, position, data: { ...node.data, title } }')).toEqual([])
    expect(flagged('const isSelected = node.selected === true')).toEqual([])
    expect(flagged('type T = { selected: boolean }')).toEqual([])
  })

  it('finds them only in the decoration and the collapse projection', () => {
    const holders = trackedSourceFiles()
      .filter(file => {
        const text = readFileSync(file, 'utf8')
        // A spread literal that sets a field has `...` and the field's name in its text, so parse
        // only those files: the result is the same, and the check does not parse the whole tree.
        if (!text.includes('...') || ![...CANVAS_ONLY_FIELDS].some(field => text.includes(field))) {
          return false
        }
        return canvasOnlyFieldsSetBySpreadLiterals(text, file).length > 0
      })
      .sort()

    expect(holders).toEqual(CANVAS_VIEW_FILES)
  })
})
