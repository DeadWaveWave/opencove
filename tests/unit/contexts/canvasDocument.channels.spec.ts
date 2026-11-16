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
    'src/contexts/workspace/presentation/renderer/components/WorkspaceCanvasInner.tsx',
    '~/WorkspaceCanvasProviders.tsx',
    '~/collapse/useCanvasCollapse.ts',
    '~/hooks/useActionRefs.ts',
    '~/hooks/useAgentLastMessageToNote.ts',
    '~/hooks/useAgentNodeLifecycle.ts',
    '~/hooks/useAgentNodeSessionControls.ts',
    '~/hooks/useAgentNodeSessionSwitch.ts',
    '~/hooks/useApplyNodeChanges.helpers.ts',
    '~/hooks/useApplyNodeChanges.ts',
    '~/hooks/useArrange.ts',
    '~/hooks/useCanvasAgentSupport.ts',
    '~/hooks/useCanvasMenuActions.ts',
    '~/hooks/useCanvasNodePublishers.ts',
    '~/hooks/useCanvasRoleUi.ts',
    '~/hooks/useCanvasRuntimeBindings.ts',
    '~/hooks/useCanvasRuntimeIntegrations.ts',
    '~/hooks/useCanvasSpaceExplorer.ts',
    '~/hooks/useCanvasTaskSupport.ts',
    '~/hooks/useCanvasTaskUi.ts',
    '~/hooks/useCanvasTaskWindows.ts',
    '~/hooks/useFilesystemNodePaths.ts',
    '~/hooks/useFilesystemNodes.ts',
    '~/hooks/useNodeDeleteConfirmation.ts',
    '~/hooks/useNodesStore.createFilesystemNodes.ts',
    '~/hooks/useNodesStore.createNodes.ts',
    '~/hooks/useNodesStore.createRoleNode.ts',
    '~/hooks/useNodesStore.createWebsiteNode.ts',
    '~/hooks/useNodesStore.ts',
    '~/hooks/useNodesStore.types.ts',
    '~/hooks/useNoteToTaskConversion.ts',
    '~/hooks/usePtyTaskCompletion.ts',
    '~/hooks/useRoleActions.run.ts',
    '~/hooks/useRoleActions.ts',
    '~/hooks/useSpaceDirectoryOps.ts',
    '~/hooks/useSpaceExplorer.materializePlacement.ts',
    '~/hooks/useSpaceExplorer.placement.ts',
    '~/hooks/useSpaceExplorer.quickPreviewActions.ts',
    '~/hooks/useSpaceExplorer.ts',
    '~/hooks/useSpaceExplorer.types.ts',
    '~/hooks/useTaskActions.agentSession.resume.ts',
    '~/hooks/useTaskActions.agentSession.run.ts',
    '~/hooks/useTaskActions.agentSession.shared.ts',
    '~/hooks/useTaskActions.ts',
    '~/hooks/useTaskEditor.ts',
    '~/hooks/useTerminalAgentSessionActions.ts',
    '~/hooks/useWorkspaceDocumentNavigation.ts',
    '~/hooks/useWorkspaceDocumentOpening.ts',
    '~/view/WorkspacePixelLayer.tsx',
  ],
  spacesRef: [
    'src/contexts/workspace/presentation/renderer/components/WorkspaceCanvasInner.tsx',
    '~/collapse/useCanvasCollapse.ts',
    '~/hooks/useAgentLauncher.ts',
    '~/hooks/useAgentNodeLifecycle.ts',
    '~/hooks/useArrange.ts',
    '~/hooks/useCanvasAgentSupport.ts',
    '~/hooks/useCanvasMenuActions.ts',
    '~/hooks/useCanvasNodeTypes.ts',
    '~/hooks/useCanvasRoleUi.ts',
    '~/hooks/useCanvasSpaceExplorer.ts',
    '~/hooks/useCanvasState.ts',
    '~/hooks/useCanvasTaskSupport.ts',
    '~/hooks/useCanvasTaskUi.ts',
    '~/hooks/useCanvasTaskWindows.ts',
    '~/hooks/useCanvasViewModel.ts',
    '~/hooks/useFilesystemNodePaths.ts',
    '~/hooks/useFilesystemNodes.ts',
    '~/hooks/useNativeFilesystemDrop.ts',
    '~/hooks/useNodeDeleteConfirmation.ts',
    '~/hooks/useNodesStore.createFilesystemNodes.ts',
    '~/hooks/useNodesStore.createNodes.ts',
    '~/hooks/useNodesStore.createPluginNode.ts',
    '~/hooks/useNodesStore.createRoleNode.ts',
    '~/hooks/useNodesStore.createWebsiteNode.ts',
    '~/hooks/useNodesStore.ts',
    '~/hooks/useNodesStore.types.ts',
    '~/hooks/useNoteToTaskConversion.ts',
    '~/hooks/useRoleActions.run.ts',
    '~/hooks/useRoleActions.ts',
    '~/hooks/useSpaceDirectoryOps.ts',
    '~/hooks/useSpaceExplorer.placement.ts',
    '~/hooks/useSpaceExplorer.ts',
    '~/hooks/useSpaceExplorer.types.ts',
    '~/hooks/useSpaceUi.ts',
    '~/hooks/useTaskActions.agentSession.resume.ts',
    '~/hooks/useTaskActions.agentSession.run.ts',
    '~/hooks/useTaskActions.agentSession.shared.ts',
    '~/hooks/useTaskActions.ts',
    '~/hooks/useTaskNodeCreation.ts',
    '~/hooks/useWorkspaceDocumentNavigation.ts',
    '~/hooks/useWorkspaceDocumentOpening.ts',
    '~/nodeTypes.context.ts',
    '~/nodeTypes.task.tsx',
    '~/nodeTypes.tsx',
  ],
  onSpacesChange: [
    'src/contexts/workspace/presentation/renderer/components/WorkspaceCanvasInner.tsx',
    '~/collapse/useCanvasCollapse.ts',
    '~/hooks/useArrange.ts',
    '~/hooks/useCanvasMenuActions.ts',
    '~/hooks/useNoteToTaskConversion.ts',
    '~/hooks/useSpaceDirectoryOps.ts',
  ],
  onRequestPersistFlush: [
    'src/app/preload/api.d.ts',
    'src/app/preload/index.ts',
    'src/app/renderer/browser/browserOpenCoveApi.ts',
    'src/app/renderer/shell/AppShell.tsx',
    'src/app/renderer/shell/components/WorkspaceMain.tsx',
    'src/app/renderer/shell/hooks/useAppQuitPersistenceFlush.ts',
    'src/contexts/task/presentation/renderer/components/promptTemplates/TaskPromptTemplatesMenu.tsx',
    'src/contexts/workspace/presentation/renderer/components/WorkspaceCanvasInner.tsx',
    '~/collapse/useCanvasCollapse.ts',
    '~/hooks/useAgentLauncher.ts',
    '~/hooks/useAgentNodeLifecycle.ts',
    '~/hooks/useAgentNodeSessionSwitch.ts',
    '~/hooks/useArrange.ts',
    '~/hooks/useCanvasAgentSupport.ts',
    '~/hooks/useCanvasMenuActions.ts',
    '~/hooks/useCanvasRoleUi.ts',
    '~/hooks/useCanvasRuntimeBindings.ts',
    '~/hooks/useCanvasRuntimeIntegrations.ts',
    '~/hooks/useCanvasSpaceExplorer.ts',
    '~/hooks/useCanvasTaskSupport.ts',
    '~/hooks/useCanvasTaskUi.ts',
    '~/hooks/useCanvasTaskWindows.ts',
    '~/hooks/useFilesystemNodes.ts',
    '~/hooks/useNodesStore.createFilesystemNodes.ts',
    '~/hooks/useNodesStore.createNodes.ts',
    '~/hooks/useNodesStore.createRoleNode.ts',
    '~/hooks/useNodesStore.createWebsiteNode.ts',
    '~/hooks/useNodesStore.noteMutations.ts',
    '~/hooks/useNodesStore.roleMutations.ts',
    '~/hooks/useNodesStore.ts',
    '~/hooks/useNodesStore.types.ts',
    '~/hooks/useNodesStore.websiteMutations.ts',
    '~/hooks/useNoteToTaskConversion.ts',
    '~/hooks/usePtyTaskCompletion.ts',
    '~/hooks/useRoleActions.run.ts',
    '~/hooks/useRoleActions.ts',
    '~/hooks/useSpaceDirectoryOps.ts',
    '~/hooks/useSpaceExplorer.ts',
    '~/hooks/useSpaceExplorer.types.ts',
    '~/hooks/useTaskActions.agentSession.resume.ts',
    '~/hooks/useTaskActions.agentSession.run.ts',
    '~/hooks/useTaskActions.agentSession.shared.ts',
    '~/hooks/useTaskActions.ts',
    '~/hooks/useTaskEditor.ts',
    '~/hooks/useTaskNodeCreation.ts',
    '~/hooks/useTerminalAgentSessionActions.ts',
    '~/hooks/useWorkspaceDocumentOpening.ts',
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
  // subscription is made at mount.
  it('no file that reads through useReadCanvasDocument subscribes to the app store', () => {
    const readers = files.filter(file =>
      /\buseReadCanvasDocument\(\)/.test(sources.get(file) ?? ''),
    )
    expect(readers.length).toBeGreaterThan(20)

    const offenders = readers.filter(file =>
      /\buseAppStore\(|\buseStore\(\s*useAppStore\b/.test(sources.get(file) ?? ''),
    )

    expect(offenders).toEqual([])
  })
})
