import type { CanvasInputMode, UiLanguage, UiTheme } from '@contexts/settings/domain/agentSettings'
import { UI_LANGUAGE_NATIVE_LABEL } from '@contexts/settings/domain/agentSettings'
import type { AppUpdateChannel, AppUpdatePolicy } from '@shared/contracts/dto'
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
    return t('settingsPanel.general.uiTheme.system')
  }

  if (theme === 'light') {
    return t('settingsPanel.general.uiTheme.light')
  }

  return t('settingsPanel.general.uiTheme.dark')
}

export function getAppUpdatePolicyLabel(t: TranslateFn, policy: AppUpdatePolicy): string {
  if (policy === 'off') {
    return t('settingsPanel.general.updates.policy.off')
  }

  if (policy === 'auto') {
    return t('settingsPanel.general.updates.policy.auto')
  }

  return t('settingsPanel.general.updates.policy.prompt')
}

export function getAppUpdateChannelLabel(t: TranslateFn, channel: AppUpdateChannel): string {
  if (channel === 'nightly') {
    return t('settingsPanel.general.updates.channel.nightly')
  }

  return t('settingsPanel.general.updates.channel.stable')
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
