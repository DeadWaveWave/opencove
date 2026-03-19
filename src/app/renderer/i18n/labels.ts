import type { CanvasInputMode, UiLanguage, UiTheme } from '@contexts/settings/domain/agentSettings'
import { UI_LANGUAGE_NATIVE_LABEL } from '@contexts/settings/domain/agentSettings'
import type {
  TaskPriority,
  TaskRuntimeStatus,
} from '@contexts/workspace/presentation/renderer/types'
import type { TranslateFn } from './index'

export function getCanvasInputModeLabel(t: TranslateFn, mode: CanvasInputMode): string {
  if (mode === 'auto') {
    return t('settingsPanel.canvas.inputMode.auto')
  }

  if (mode === 'trackpad') {
    return t('settingsPanel.canvas.inputMode.trackpad')
  }

  return t('settingsPanel.canvas.inputMode.mouse')
}

export function getUiThemeLabel(t: TranslateFn, theme: UiTheme): string {
  if (theme === 'system') {
    return t('settingsPanel.canvas.uiTheme.system')
  }

  if (theme === 'light') {
    return t('settingsPanel.canvas.uiTheme.light')
  }

  return t('settingsPanel.canvas.uiTheme.dark')
}

export function getTaskPriorityLabel(t: TranslateFn, priority: TaskPriority): string {
  switch (priority) {
    case 'low':
      return t('taskPriorities.low')
    case 'high':
      return t('taskPriorities.high')
    case 'urgent':
      return t('taskPriorities.urgent')
    default:
      return t('taskPriorities.medium')
  }
}

export function getTaskStatusLabel(t: TranslateFn, status: TaskRuntimeStatus): string {
  switch (status) {
    case 'todo':
      return t('taskStatuses.todo')
    case 'doing':
      return t('taskStatuses.doing')
    case 'ai_done':
      return t('taskStatuses.aiDone')
    default:
      return t('taskStatuses.done')
  }
}

export function getUiLanguageLabel(language: UiLanguage): string {
  return UI_LANGUAGE_NATIVE_LABEL[language]
}
