import type { CanvasNodeWriter } from '../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasNodeWriter'

/**
 * `useCanvasNodeWriter` with the writer that a case can pin. The real writer changes with the
 * workspace of the provider, so a hook that takes it from context rebuilds its callbacks on a
 * switch, which would hide a reader or a command missing from a dependency list. While
 * `isStable()` is true the hook gets one writer for the whole test, which writes through the
 * writer of the latest render: nothing about it changes, and only the reader or the commands
 * under test can make a callback follow the workspace that is shown.
 *
 * Use it from `vi.mock` of the `useCanvasNodeWriter` module:
 * `vi.mock(path, async importOriginal => mockStableNodeWriter(await importOriginal(), () => control.on))`.
 */
export function mockStableNodeWriter<
  Module extends { useCanvasNodeWriter: () => CanvasNodeWriter },
>(original: Module, isStable: () => boolean): Module {
  let latest: CanvasNodeWriter | null = null
  let stable: CanvasNodeWriter | null = null
  return {
    ...original,
    useCanvasNodeWriter: (): CanvasNodeWriter => {
      const real = original.useCanvasNodeWriter()
      latest = real
      stable ??= {
        updateNodes: (updater, options) => latest!.updateNodes(updater, options),
        updateCanvasDocument: (recipe, options) => latest!.updateCanvasDocument(recipe, options),
      }
      return isStable() ? stable : real
    },
  }
}
