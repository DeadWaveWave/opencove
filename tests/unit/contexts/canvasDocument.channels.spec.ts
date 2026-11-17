import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Invariant 1 of #702 (S5 of #647): outside the files listed here, canvas code reads committed
// nodes and Spaces through `useReadCanvasDocument()` and writes Spaces through
// `useCanvasDocumentCommands()`. Each pull request of the slice shrinks these lists; a file that
// names one of the retired channels again, or a file that no longer does but is still listed,
// fails. `~/` stands for the workspaceCanvas component directory.
const CANVAS_DIR = 'src/contexts/workspace/presentation/renderer/components/workspaceCanvas/'

const ALLOWED_FILES: Record<string, readonly string[]> = {
  nodesRef: [
    '~/hooks/useApplyNodeChanges.helpers.ts',
    '~/hooks/useApplyNodeChanges.ts',
    '~/hooks/useCanvasNodePublishers.ts',
    '~/hooks/useCanvasRuntimeIntegrations.ts',
    '~/hooks/useNodesStore.ts',
    '~/hooks/useNodesStore.types.ts',
    '~/view/WorkspacePixelLayer.tsx',
  ],
  spacesRef: [],
  onSpacesChange: [],
  onRequestPersistFlush: [
    'src/app/preload/api.d.ts',
    'src/app/preload/index.ts',
    'src/app/renderer/browser/browserOpenCoveApi.ts',
    'src/app/renderer/shell/AppShell.tsx',
    'src/app/renderer/shell/components/WorkspaceMain.tsx',
    'src/app/renderer/shell/hooks/useAppQuitPersistenceFlush.ts',
    'src/contexts/task/presentation/renderer/components/promptTemplates/TaskPromptTemplatesMenu.tsx',
    '~/types.ts',
  ],
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

  // `spacesRef` is a getter over the store: a write to it throws at run time, so a direct write
  // is a bug even where the type would allow it.
  it('nothing assigns spacesRef.current', () => {
    const offenders = files.filter(file =>
      /\bspacesRef\s*\.\s*current\s*=(?!=)/.test(sources.get(file) ?? ''),
    )

    expect(offenders).toEqual([])
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
