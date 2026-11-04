import {
  APP_COMMAND_IDS,
  WORKSPACE_CANVAS_COMMAND_IDS,
} from '@contexts/settings/domain/keybindings'
import { isSpatialNavigationCommandId } from './shortcuts/ShortcutKeycaps'
import { getCommandHelpKey, getCommandTitleKey } from './shortcuts/shortcutCommandKeys'
import type { CoreSettingsSearchEntryDefinition } from './settingsSearchTypes'

/** One entry per keybinding row, built from the same command lists the Shortcuts page shows. */
export const SHORTCUT_SEARCH_ENTRY_DEFINITIONS: CoreSettingsSearchEntryDefinition[] = [
  ...APP_COMMAND_IDS,
  ...WORKSPACE_CANVAS_COMMAND_IDS.filter(commandId => !isSpatialNavigationCommandId(commandId)),
].map(commandId => ({
  id: `shortcuts.${commandId}`,
  pageId: 'tasks-shortcuts',
  titleKey: getCommandTitleKey(commandId),
  descriptionKey: getCommandHelpKey(commandId),
  anchorId: 'settings-section-keybindings',
  keywordKeys: ['settingsPanel.shortcuts.bindings'],
  keywords: ['shortcut', 'keybinding', 'hotkey', '快捷键'],
}))

SHORTCUT_SEARCH_ENTRY_DEFINITIONS.push({
  id: 'shortcuts.spatial-navigation',
  pageId: 'tasks-shortcuts',
  titleKey: 'settingsPanel.shortcuts.spatialNavigation.title',
  descriptionKey: 'settingsPanel.shortcuts.spatialNavigation.help',
  anchorId: 'settings-section-keybindings',
  keywordKeys: ['settingsPanel.shortcuts.bindings'],
  keywords: ['arrow', 'beam', 'navigate', 'shortcut', '方向', '导航', '快捷键'],
})
