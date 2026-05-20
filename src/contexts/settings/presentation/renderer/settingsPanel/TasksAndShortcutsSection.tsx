import React from 'react'
import {
  type AgentProvider,
  type TaskTitleAgentProvider,
  type QuickCommand,
  type QuickPhrase,
  type TaskTitleProvider,
} from '@contexts/settings/domain/agentSettings'
import type { KeybindingOverrides } from '@contexts/settings/domain/keybindings'
import { QuickMenuSection } from './QuickMenuSection'
import { ShortcutsSection } from './ShortcutsSection'
import { TaskConfigurationSection } from './TaskConfigurationSection'

export function TasksAndShortcutsSection({
  showTaskTitleGeneration,
  defaultProvider,
  taskTitleProvider,
  taskTitleModel,
  effectiveTaskTitleProvider,
  tags,
  addTaskTagInput,
  quickCommands,
  quickPhrases,
  disableAppShortcutsWhenTerminalFocused,
  keybindings,
  onChangeTaskTitleProvider,
  onChangeTaskTitleModel,
  onChangeAddTaskTagInput,
  onAddTag,
  onRemoveTag,
  onChangeQuickCommands,
  onChangeQuickPhrases,
  onChangeDisableAppShortcutsWhenTerminalFocused,
  onChangeKeybindings,
}: {
  showTaskTitleGeneration: boolean
  defaultProvider: AgentProvider
  taskTitleProvider: TaskTitleProvider
  taskTitleModel: string
  effectiveTaskTitleProvider: TaskTitleAgentProvider
  tags: string[]
  addTaskTagInput: string
  quickCommands: QuickCommand[]
  quickPhrases: QuickPhrase[]
  disableAppShortcutsWhenTerminalFocused: boolean
  keybindings: KeybindingOverrides
  onChangeTaskTitleProvider: (provider: TaskTitleProvider) => void
  onChangeTaskTitleModel: (model: string) => void
  onChangeAddTaskTagInput: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
  onChangeQuickCommands: (commands: QuickCommand[]) => void
  onChangeQuickPhrases: (phrases: QuickPhrase[]) => void
  onChangeDisableAppShortcutsWhenTerminalFocused: (enabled: boolean) => void
  onChangeKeybindings: (keybindings: KeybindingOverrides) => void
}): React.JSX.Element {
  return (
    <>
      <TaskConfigurationSection
        showTaskTitleGeneration={showTaskTitleGeneration}
        defaultProvider={defaultProvider}
        taskTitleProvider={taskTitleProvider}
        taskTitleModel={taskTitleModel}
        effectiveTaskTitleProvider={effectiveTaskTitleProvider}
        tags={tags}
        addTaskTagInput={addTaskTagInput}
        onChangeTaskTitleProvider={onChangeTaskTitleProvider}
        onChangeTaskTitleModel={onChangeTaskTitleModel}
        onChangeAddTaskTagInput={onChangeAddTaskTagInput}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
      />
      <QuickMenuSection
        quickCommands={quickCommands}
        quickPhrases={quickPhrases}
        onChangeQuickCommands={onChangeQuickCommands}
        onChangeQuickPhrases={onChangeQuickPhrases}
      />
      <ShortcutsSection
        disableAppShortcutsWhenTerminalFocused={disableAppShortcutsWhenTerminalFocused}
        keybindings={keybindings}
        onChangeDisableAppShortcutsWhenTerminalFocused={
          onChangeDisableAppShortcutsWhenTerminalFocused
        }
        onChangeKeybindings={onChangeKeybindings}
      />
    </>
  )
}
