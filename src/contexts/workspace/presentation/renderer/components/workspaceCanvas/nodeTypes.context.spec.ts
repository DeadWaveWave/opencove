import type { ComponentProps, MutableRefObject, RefObject } from 'react'
import type { Node } from '@xyflow/react'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { TerminalNodeData } from '../../types'
import type * as CommandsModule from './nodeCommands'
import type { CanvasNodeCommands } from './nodeCommands'
import type * as ContextModule from './nodeTypes.context'
import type { WorkspaceCanvasNodeTypesParams } from './nodeTypes.context'
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

/** Every path, at any depth, whose type is a React ref. Functions are leaves; arrays are walked. */
type RefPaths<T, P extends string = ''> = T extends MutableRefObject<unknown> | RefObject<unknown>
  ? P
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer E)[]
      ? RefPaths<E, `${P}.${number}`>
      : T extends object
        ? {
            [K in keyof T & string]-?: RefPaths<T[K], P extends '' ? K : `${P}.${K}`>
          }[keyof T & string]
        : never

/** A node, a node's `data`, or the part of a node a command could be handed in place of one. */
type NodeLike = Pick<Node, 'id' | 'position'> | TerminalNodeData
/** `true` when `T` is a node-like value, or an array of them. */
type IsNodeLike<T> = T extends NodeLike
  ? true
  : T extends readonly (infer E)[]
    ? E extends NodeLike
      ? true
      : never
    : never
/** `true` when `T` is node-like, or an object with a node-like property (one level deep). */
type HoldsNode<T> =
  | IsNodeLike<T>
  | (T extends readonly unknown[]
      ? never
      : T extends object
        ? { [K in keyof T]-?: IsNodeLike<NonNullable<T[K]>> }[keyof T]
        : never)

/** `family.command` for every command with a parameter that holds a node. */
type NodeTakingCommands<C> = {
  [F in keyof C & string]: {
    [K in keyof C[F] & string]: C[F][K] extends (...args: infer A) => unknown
      ? [HoldsNode<A[number]>] extends [never]
        ? never
        : `${F}.${K}`
      : never
  }[keyof C[F] & string]
}[keyof C & string]

/** The 8 refs that the terminal family replaced (PR 5). */
type RetiredTerminalRef =
  | 'copyAgentLastMessageRef'
  | 'reloadAgentSessionRef'
  | 'listAgentSessionsRef'
  | 'switchAgentSessionRef'
  | 'updateNodeScrollbackRef'
  | 'updateTerminalTitleRef'
  | 'clearTerminalAgentOverlayRef'
  | 'renameTerminalTitleRef'

/** The 3 refs that the role family replaced (PR 6). */
type RetiredRoleRef = 'updateRoleProviderRef' | 'updateRoleInputRef' | 'runRoleRef'

/** The 7 refs that the task family replaced (PR 7), the last of the action refs. */
type RetiredTaskRef =
  | 'openTaskEditorRef'
  | 'quickUpdateTaskTitleRef'
  | 'quickUpdateTaskRequirementRef'
  | 'runTaskAgentRef'
  | 'resumeTaskAgentSessionRef'
  | 'removeTaskAgentSessionRecordRef'
  | 'updateTaskStatusRef'

/** The 12 refs and the 3 callbacks that the window, note and website families replaced (PR 4). */
type RetiredField =
  | RetiredTerminalRef
  | RetiredRoleRef
  | RetiredTaskRef
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

describe('the node types context (#647 S7, PRs 4 to 7)', () => {
  it('finds a ref wherever it is, so the checks below cannot pass vacuously', () => {
    expectTypeOf<RefPaths<{ a: { b: MutableRefObject<number> } }>>().toEqualTypeOf<'a.b'>()
    expectTypeOf<RefPaths<{ a: RefObject<number | null>; f: () => void }>>().toEqualTypeOf<'a'>()
  })

  it('finds a ref inside an array, so the check cannot pass vacuously', () => {
    expectTypeOf<
      RefPaths<{ list: Array<{ current: number }>; m(): void }>
    >().toEqualTypeOf<`list.${number}`>()
    expectTypeOf<RefPaths<readonly [MutableRefObject<number>]>>().toEqualTypeOf<`.${number}`>()
  })

  it('finds a command that takes a node, wherever the node is, so the check cannot pass vacuously', () => {
    type Frame = { position: { x: number; y: number }; size: { width: number } }
    type Probe = {
      window: {
        node(node: Node, frame: number): void
        nodes(nodes: Node[]): void
        data(data: TerminalNodeData): void
        snapshot(snapshot: { id: string; position: { x: number; y: number } }): void
        options(id: string, options?: { toggle?: boolean; node?: Node }): void
        // What commands take today: ids, values and frames.
        id(id: string, frame: Frame | null): void
        ids(ids: readonly string[], options?: { toggle?: boolean }): void
      }
    }
    expectTypeOf<NodeTakingCommands<Probe>>().toEqualTypeOf<
      'window.node' | 'window.nodes' | 'window.data' | 'window.snapshot' | 'window.options'
    >()
  })

  it('holds no ref in the commands, at any depth', () => {
    expectTypeOf<RefPaths<CanvasNodeCommands>>().toEqualTypeOf<never>()
    expectTypeOf<RefPaths<WorkspaceCanvasNodeTypesParams['commands']>>().toEqualTypeOf<never>()
  })

  it('holds no ref in the node types params, at any depth (#647 acceptance)', () => {
    expectTypeOf<RefPaths<WorkspaceCanvasNodeTypesParams>>().toEqualTypeOf<never>()
  })

  it('has no transitional shape left: the bag of refs and the partial command type are gone', () => {
    // The directive of each line is consumed only by the error that its name is not exported: the
    // line is a type alias of a namespace import, so nothing else can fail on it. A name that came
    // back would leave the directive unused, which `pnpm check` fails.
    // @ts-expect-error -- TransitionalNodeActionRefs is gone; the params hold `commands` only (#647 S7)
    type GoneTransitionalRefs = ContextModule.TransitionalNodeActionRefs
    // @ts-expect-error -- WiredCanvasNodeCommands is gone; the commands are `CanvasNodeCommands` (#647 S7)
    type GoneWiredCommands = CommandsModule.WiredCanvasNodeCommands
    // A name that does not exist resolves to `any`: both are, and an alias of a real type is not.
    expectTypeOf<GoneTransitionalRefs>().toBeAny()
    expectTypeOf<GoneWiredCommands>().toBeAny()
    // The params are exactly the preferences and the commands.
    expectTypeOf<keyof WorkspaceCanvasNodeTypesParams>().toEqualTypeOf<
      | 'workspacePath'
      | 'onShowMessage'
      | 'agentProviderOrder'
      | 'defaultProvider'
      | 'browserDefaultMode'
      | 'browserSearchEngine'
      | 'commands'
    >()
    expectTypeOf<WorkspaceCanvasNodeTypesParams['commands']>().toEqualTypeOf<CanvasNodeCommands>()
  })

  it('gives no node type component a ref prop', () => {
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasTaskNodeType>>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasTerminalNodeType>>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      RefPaths<ComponentProps<typeof WorkspaceCanvasRoleNodeType>>
    >().toEqualTypeOf<never>()
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

  it('pins each retired terminal ref by key too, one by one, so one cannot hide behind another', () => {
    expectTypeOf<
      'copyAgentLastMessageRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'reloadAgentSessionRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'listAgentSessionsRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'switchAgentSessionRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'updateNodeScrollbackRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'updateTerminalTitleRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'clearTerminalAgentOverlayRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'renameTerminalTitleRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    // None of them is a prop of the terminal component either.
    expectTypeOf<
      Extract<keyof ComponentProps<typeof WorkspaceCanvasTerminalNodeType>, RetiredTerminalRef>
    >().toEqualTypeOf<never>()
  })

  it('has a terminal family of the eight commands the terminal window calls', () => {
    expectTypeOf<keyof CanvasNodeCommands['terminal']>().toEqualTypeOf<
      | 'updateScrollback'
      | 'recordCommandRun'
      | 'clearAgentOverlay'
      | 'renameTitle'
      | 'copyLastAgentMessage'
      | 'reloadAgentSession'
      | 'listAgentSessions'
      | 'switchAgentSession'
    >()
    expectTypeOf<WorkspaceCanvasNodeTypesParams['commands']['terminal']>().toEqualTypeOf<
      CanvasNodeCommands['terminal']
    >()
  })

  it('pins each retired role ref by key too, one by one, so one cannot hide behind another', () => {
    expectTypeOf<
      'updateRoleProviderRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'updateRoleInputRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'runRoleRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    // None of them is a prop of the role component either.
    expectTypeOf<
      Extract<keyof ComponentProps<typeof WorkspaceCanvasRoleNodeType>, RetiredRoleRef>
    >().toEqualTypeOf<never>()
  })

  it('has a role family of the three commands the role window calls', () => {
    expectTypeOf<keyof CanvasNodeCommands['role']>().toEqualTypeOf<
      'updateInput' | 'updateProvider' | 'run'
    >()
    expectTypeOf<WorkspaceCanvasNodeTypesParams['commands']['role']>().toEqualTypeOf<
      CanvasNodeCommands['role']
    >()
  })

  it('pins each retired task ref by key too, one by one, so one cannot hide behind another', () => {
    expectTypeOf<
      'openTaskEditorRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'quickUpdateTaskTitleRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'quickUpdateTaskRequirementRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'runTaskAgentRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'resumeTaskAgentSessionRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'removeTaskAgentSessionRecordRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'updateTaskStatusRef' extends keyof WorkspaceCanvasNodeTypesParams ? true : false
    >().toEqualTypeOf<false>()
    // None of them is a prop of the task component either, and it takes no settings.
    expectTypeOf<
      Extract<keyof ComponentProps<typeof WorkspaceCanvasTaskNodeType>, RetiredTaskRef>
    >().toEqualTypeOf<never>()
  })

  it('has a task family of the seven commands the task window calls', () => {
    expectTypeOf<keyof CanvasNodeCommands['task']>().toEqualTypeOf<
      | 'runAgent'
      | 'resumeAgentSession'
      | 'removeAgentSessionRecord'
      | 'openEditor'
      | 'updateTitle'
      | 'updateRequirement'
      | 'updateStatus'
    >()
    expectTypeOf<WorkspaceCanvasNodeTypesParams['commands']['task']>().toEqualTypeOf<
      CanvasNodeCommands['task']
    >()
  })

  it('names none of the retired action refs', () => {
    const params = {} as WorkspaceCanvasNodeTypesParams
    // @ts-expect-error -- copyAgentLastMessageRef is retired; call commands.terminal.copyLastAgentMessage (#647 S7)
    expect(params.copyAgentLastMessageRef).toBeUndefined()
    // @ts-expect-error -- reloadAgentSessionRef is retired; call commands.terminal.reloadAgentSession (#647 S7)
    expect(params.reloadAgentSessionRef).toBeUndefined()
    // @ts-expect-error -- listAgentSessionsRef is retired; call commands.terminal.listAgentSessions (#647 S7)
    expect(params.listAgentSessionsRef).toBeUndefined()
    // @ts-expect-error -- switchAgentSessionRef is retired; call commands.terminal.switchAgentSession (#647 S7)
    expect(params.switchAgentSessionRef).toBeUndefined()
    // @ts-expect-error -- updateNodeScrollbackRef is retired; call commands.terminal.updateScrollback (#647 S7)
    expect(params.updateNodeScrollbackRef).toBeUndefined()
    // @ts-expect-error -- updateTerminalTitleRef is retired; call commands.terminal.recordCommandRun (#647 S7)
    expect(params.updateTerminalTitleRef).toBeUndefined()
    // @ts-expect-error -- clearTerminalAgentOverlayRef is retired; call commands.terminal.clearAgentOverlay (#647 S7)
    expect(params.clearTerminalAgentOverlayRef).toBeUndefined()
    // @ts-expect-error -- renameTerminalTitleRef is retired; call commands.terminal.renameTitle (#647 S7)
    expect(params.renameTerminalTitleRef).toBeUndefined()
    // @ts-expect-error -- updateRoleProviderRef is retired; call commands.role.updateProvider (#647 S7)
    expect(params.updateRoleProviderRef).toBeUndefined()
    // @ts-expect-error -- updateRoleInputRef is retired; call commands.role.updateInput (#647 S7)
    expect(params.updateRoleInputRef).toBeUndefined()
    // @ts-expect-error -- runRoleRef is retired; call commands.role.run (#647 S7)
    expect(params.runRoleRef).toBeUndefined()
    // @ts-expect-error -- openTaskEditorRef is retired; call commands.task.openEditor (#647 S7)
    expect(params.openTaskEditorRef).toBeUndefined()
    // @ts-expect-error -- quickUpdateTaskTitleRef is retired; call commands.task.updateTitle (#647 S7)
    expect(params.quickUpdateTaskTitleRef).toBeUndefined()
    // @ts-expect-error -- quickUpdateTaskRequirementRef is retired; call commands.task.updateRequirement (#647 S7)
    expect(params.quickUpdateTaskRequirementRef).toBeUndefined()
    // @ts-expect-error -- runTaskAgentRef is retired; call commands.task.runAgent (#647 S7)
    expect(params.runTaskAgentRef).toBeUndefined()
    // @ts-expect-error -- resumeTaskAgentSessionRef is retired; call commands.task.resumeAgentSession (#647 S7)
    expect(params.resumeTaskAgentSessionRef).toBeUndefined()
    // @ts-expect-error -- removeTaskAgentSessionRecordRef is retired; call commands.task.removeAgentSessionRecord (#647 S7)
    expect(params.removeTaskAgentSessionRecordRef).toBeUndefined()
    // @ts-expect-error -- updateTaskStatusRef is retired; call commands.task.updateStatus (#647 S7)
    expect(params.updateTaskStatusRef).toBeUndefined()
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
