import type { ComponentProps, MutableRefObject, RefObject } from 'react'
import type { Node } from '@xyflow/react'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { CanvasNodeCommands } from './nodeCommands'
import type {
  TransitionalNodeActionRefs,
  WorkspaceCanvasNodeTypesParams,
} from './nodeTypes.context'
import type { WorkspaceCanvasDocumentNodeType } from './nodeTypes.document'
import type { WorkspaceCanvasFolderNodeType } from './nodeTypes.folder'
import type { WorkspaceCanvasImageNodeType } from './nodeTypes.image'
import type { WorkspaceCanvasNoteNodeType } from './nodeTypes.note'
import type { WorkspaceCanvasPluginNodeType } from './nodeTypes.plugin'
import type { WorkspaceCanvasRoleNodeType } from './nodeTypes.role'
import type { WorkspaceCanvasTaskNodeType } from './nodeTypes.task'
import type { WorkspaceCanvasTerminalNodeType } from './nodeTypes.terminal'
import type { WorkspaceCanvasWebsiteNodeType } from './nodeTypes.website'

// `pnpm check` compiles this file: each directive below fails the build as an unused directive
// when the field it names comes back. A directive is consumed by any error on its line, so the
// retired names are also pinned as keys, which no other error can satisfy.

/** Every path, at any depth, whose type is a React ref. Functions are leaves. */
type RefPaths<T, P extends string = ''> = T extends MutableRefObject<unknown> | RefObject<unknown>
  ? P
  : T extends (...args: never[]) => unknown
    ? never
    : T extends object
      ? {
          [K in keyof T & string]-?: RefPaths<T[K], P extends '' ? K : `${P}.${K}`>
        }[keyof T & string]
      : never

/** `family.command` for every command with a parameter that is a node object. */
type NodeTakingCommands<C> = {
  [F in keyof C & string]: {
    [K in keyof C[F] & string]: C[F][K] extends (...args: infer A) => unknown
      ? Extract<A[number], Pick<Node, 'id' | 'position'>> extends never
        ? never
        : `${F}.${K}`
      : never
  }[keyof C[F] & string]
}[keyof C & string]

/** The 12 refs and the 3 callbacks that the window, note and website families replaced (PR 4). */
type RetiredField =
  | 'selectNode'
  | 'convertNoteToTask'
  | 'setNodeLabelColorOverride'
  | 'clearNodeSelectionRef'
  | 'closeNodeRef'
  | 'resizeNodeRef'
  | 'normalizeViewportForTerminalInteractionRef'
  | 'requestNodeDeleteRef'
  | 'updateNoteTextRef'
  | 'renameNoteTitleRef'
  | 'updateWebsiteUrlRef'
  | 'setWebsitePinnedRef'
  | 'setWebsiteSessionRef'
  | 'setWebsiteModeRef'
  | 'setWebsiteFullscreenRef'

type WindowCallbackProp =
  | 'selectNode'
  | 'clearNodeSelectionRef'
  | 'closeNodeRef'
  | 'resizeNodeRef'
  | 'normalizeViewportForTerminalInteractionRef'
  | 'requestNodeDeleteRef'

describe('the node types context (#647 S7, PR 4)', () => {
  it('finds a ref wherever it is, so the checks below cannot pass vacuously', () => {
    expectTypeOf<RefPaths<{ a: { b: MutableRefObject<number> } }>>().toEqualTypeOf<'a.b'>()
    expectTypeOf<RefPaths<{ a: RefObject<number | null>; f: () => void }>>().toEqualTypeOf<'a'>()
  })

  it('finds a command that takes a node object, so the check below cannot pass vacuously', () => {
    expectTypeOf<
      NodeTakingCommands<{
        window: { resize(node: Node, frame: number): void; close(id: string): void }
      }>
    >().toEqualTypeOf<'window.resize'>()
  })

  it('holds no ref in the commands, at any depth', () => {
    expectTypeOf<RefPaths<CanvasNodeCommands>>().toEqualTypeOf<never>()
    expectTypeOf<RefPaths<WorkspaceCanvasNodeTypesParams['commands']>>().toEqualTypeOf<never>()
  })

  it('holds no ref in the params but the transitional ones, which PRs 5 to 7 retire', () => {
    // Exactly this set: a ref of another family cannot return, and a transitional one cannot stay
    // after its family moved (the set is replaced by `never` in PR 7).
    expectTypeOf<RefPaths<WorkspaceCanvasNodeTypesParams>>().toEqualTypeOf<
      keyof TransitionalNodeActionRefs
    >()
  })

  it('lists the transitional refs by name, so that a new one cannot join them unnoticed', () => {
    expectTypeOf<keyof TransitionalNodeActionRefs>().toEqualTypeOf<
      // Terminal (PR 5)
      | 'copyAgentLastMessageRef'
      | 'reloadAgentSessionRef'
      | 'listAgentSessionsRef'
      | 'switchAgentSessionRef'
      | 'updateNodeScrollbackRef'
      | 'updateTerminalTitleRef'
      | 'clearTerminalAgentOverlayRef'
      | 'renameTerminalTitleRef'
      // Role (PR 6)
      | 'updateRoleProviderRef'
      | 'updateRoleInputRef'
      | 'runRoleRef'
      // Task (PR 7)
      | 'openTaskEditorRef'
      | 'quickUpdateTaskTitleRef'
      | 'quickUpdateTaskRequirementRef'
      | 'runTaskAgentRef'
      | 'resumeTaskAgentSessionRef'
      | 'removeTaskAgentSessionRecordRef'
      | 'updateTaskStatusRef'
    >()
  })

  it('gives no note, website, document, folder, image or plugin component a ref prop', () => {
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasNoteNodeType>>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasWebsiteNodeType>>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasDocumentNodeType>>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasFolderNodeType>>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasImageNodeType>>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasPluginNodeType>>
    >().toEqualTypeOf<never>()
  })

  it('takes the window callbacks of the terminal, task and role components from the commands', () => {
    expectTypeOf<
      Extract<keyof ComponentProps<typeof WorkspaceCanvasTerminalNodeType>, WindowCallbackProp>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Extract<keyof ComponentProps<typeof WorkspaceCanvasTaskNodeType>, WindowCallbackProp>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Extract<keyof ComponentProps<typeof WorkspaceCanvasRoleNodeType>, WindowCallbackProp>
    >().toEqualTypeOf<never>()
  })

  it('has no command that takes a node object; commands take ids and read the document', () => {
    expectTypeOf<NodeTakingCommands<CanvasNodeCommands>>().toEqualTypeOf<never>()
  })

  it('names none of the retired fields among its keys, whatever else is wrong on a line', () => {
    expectTypeOf<
      Extract<keyof WorkspaceCanvasNodeTypesParams, RetiredField>
    >().toEqualTypeOf<never>()
  })

  it('names none of the retired action refs', () => {
    const params = {} as WorkspaceCanvasNodeTypesParams
    // @ts-expect-error -- selectNode is retired; call commands.window.select (#647 S7)
    expect(params.selectNode).toBeUndefined()
    // @ts-expect-error -- convertNoteToTask is retired; call commands.note.convertToTask (#647 S7)
    expect(params.convertNoteToTask).toBeUndefined()
    // @ts-expect-error -- setNodeLabelColorOverride is retired; call commands.window.setLabelColorOverride (#647 S7)
    expect(params.setNodeLabelColorOverride).toBeUndefined()
    // @ts-expect-error -- clearNodeSelectionRef is retired; call commands.window.clearSelection (#647 S7)
    expect(params.clearNodeSelectionRef).toBeUndefined()
    // @ts-expect-error -- closeNodeRef is retired; call commands.window.close (#647 S7)
    expect(params.closeNodeRef).toBeUndefined()
    // @ts-expect-error -- resizeNodeRef is retired; call commands.window.resize (#647 S7)
    expect(params.resizeNodeRef).toBeUndefined()
    // @ts-expect-error -- normalizeViewportForTerminalInteractionRef is retired; call commands.window.focusForInteraction (#647 S7)
    expect(params.normalizeViewportForTerminalInteractionRef).toBeUndefined()
    // @ts-expect-error -- requestNodeDeleteRef is retired; call commands.window.requestDelete (#647 S7)
    expect(params.requestNodeDeleteRef).toBeUndefined()
    // @ts-expect-error -- updateNoteTextRef is retired; call commands.note.updateText (#647 S7)
    expect(params.updateNoteTextRef).toBeUndefined()
    // @ts-expect-error -- renameNoteTitleRef is retired; call commands.note.renameTitle (#647 S7)
    expect(params.renameNoteTitleRef).toBeUndefined()
    // @ts-expect-error -- updateWebsiteUrlRef is retired; call commands.website.updateUrl (#647 S7)
    expect(params.updateWebsiteUrlRef).toBeUndefined()
    // @ts-expect-error -- setWebsitePinnedRef is retired; call commands.website.setPinned (#647 S7)
    expect(params.setWebsitePinnedRef).toBeUndefined()
    // @ts-expect-error -- setWebsiteSessionRef is retired; call commands.website.setSession (#647 S7)
    expect(params.setWebsiteSessionRef).toBeUndefined()
    // @ts-expect-error -- setWebsiteModeRef is retired; call commands.website.setMode (#647 S7)
    expect(params.setWebsiteModeRef).toBeUndefined()
    // @ts-expect-error -- setWebsiteFullscreenRef is retired; call commands.website.setFullscreen (#647 S7)
    expect(params.setWebsiteFullscreenRef).toBeUndefined()
  })
})
