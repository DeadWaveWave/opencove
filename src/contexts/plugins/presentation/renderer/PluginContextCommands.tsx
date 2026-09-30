import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { PluginHostContext } from '../../domain/pluginRuntimeTypes'
import { usePluginCommands } from './usePluginCommands'
import { PluginIcon } from './PluginIcon'

export function PluginContextCommands({
  surface,
  nodeIds,
  spaceId,
  onClose,
}: Pick<PluginHostContext, 'surface' | 'nodeIds' | 'spaceId'> & { onClose: () => void }) {
  const projectId = useAppStore(state => state.activeWorkspaceId)
  const { items, run } = usePluginCommands(
    {
      surface,
      ...(projectId ? { projectId } : {}),
      ...(nodeIds?.length ? { nodeIds } : {}),
      ...(spaceId ? { spaceId } : {}),
    },
    !!projectId && (surface !== 'node' || !!nodeIds?.length),
  )
  if (!items.length) {
    return null
  }
  return (
    <>
      <div className="workspace-context-menu__separator" />
      {items.map(item => (
        <button
          type="button"
          key={item.id}
          data-testid={`plugin-menu-command-${item.id}`}
          onClick={() => {
            onClose()
            void run(item)
          }}
        >
          <PluginIcon pluginId={item.plugin.id} className="workspace-context-menu__icon" />
          <span className="workspace-context-menu__label">{item.title}</span>
        </button>
      ))}
    </>
  )
}
