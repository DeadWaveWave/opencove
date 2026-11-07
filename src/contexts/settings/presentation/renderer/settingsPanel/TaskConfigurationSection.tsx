import React from 'react'
import { Button } from '@app/renderer/components/ui/Button'
import { SettingRow } from '@app/renderer/components/ui/SettingRow'
import { X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  TASK_TITLE_PROVIDERS,
  type TaskTitleAgentProvider,
  type TaskTitleProvider,
} from '@contexts/settings/domain/agentSettings'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function TaskConfigurationSection(props: {
  showTaskTitleGeneration: boolean
  taskTitleProvider: TaskTitleProvider
  taskTitleModel: string
  effectiveTaskTitleProvider: TaskTitleAgentProvider
  tags: string[]
  addTaskTagInput: string
  onChangeTaskTitleProvider: (provider: TaskTitleProvider) => void
  onChangeTaskTitleModel: (model: string) => void
  onChangeAddTaskTagInput: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    taskTitleProvider,
    taskTitleModel,
    effectiveTaskTitleProvider,
    tags,
    addTaskTagInput,
    onChangeTaskTitleProvider,
    onChangeTaskTitleModel,
    onChangeAddTaskTagInput,
    onAddTag,
    onRemoveTag,
  } = props

  return (
    <>
      {props.showTaskTitleGeneration ? (
        <SettingsGroup
          id="settings-section-task-configuration"
          title={t('settingsPanel.groups.tasksShortcuts.taskTitles')}
        >
          <SettingsGroupBody>
            <SettingRow
              label={t('settingsPanel.tasks.titleProviderLabel')}
              description={t('settingsPanel.tasks.titleProviderHelp')}
              control={
                <CoveSelect
                  id="settings-task-title-provider"
                  testId="settings-task-title-provider"
                  ariaLabel={t('settingsPanel.tasks.titleProviderLabel')}
                  value={taskTitleProvider}
                  options={[
                    {
                      value: 'default',
                      label: t('settingsPanel.tasks.followDefaultAgent', {
                        provider: AGENT_PROVIDER_LABEL[effectiveTaskTitleProvider],
                      }),
                    },
                    ...TASK_TITLE_PROVIDERS.map(provider => ({
                      value: provider,
                      label: AGENT_PROVIDER_LABEL[provider],
                    })),
                  ]}
                  onChange={nextValue => {
                    onChangeTaskTitleProvider(nextValue as TaskTitleProvider)
                  }}
                />
              }
            />

            <SettingRow
              label={t('settingsPanel.tasks.titleModelLabel')}
              description={t('settingsPanel.tasks.titleModelHelp')}
              control={
                <input
                  type="text"
                  id="settings-task-title-model"
                  data-testid="settings-task-title-model"
                  aria-label={t('settingsPanel.tasks.titleModelLabel')}
                  className="cove-field"
                  value={taskTitleModel}
                  placeholder={t('common.followCliDefault')}
                  onChange={event => {
                    onChangeTaskTitleModel(event.target.value)
                  }}
                />
              }
            />

            <SettingRow
              label={t('settingsPanel.tasks.effectiveProviderLabel')}
              description={t('settingsPanel.tasks.effectiveProviderHelp')}
              value={
                <span className="settings-panel__value">
                  {AGENT_PROVIDER_LABEL[effectiveTaskTitleProvider]}
                </span>
              }
            />
          </SettingsGroupBody>
        </SettingsGroup>
      ) : null}

      <SettingsGroup
        id="settings-section-task-tags"
        title={t('settingsPanel.groups.tasksShortcuts.taskTags')}
        description={t('settingsPanel.tasks.tagsHelp')}
      >
        <div
          className="settings-list-container settings-task-tags"
          data-testid="settings-task-tag-list"
        >
          {tags.map(tag => (
            <div className="settings-list-item" key={tag}>
              <span className="settings-panel__value">{tag}</span>
              <button
                type="button"
                className="settings-task-tags__remove"
                data-testid={`settings-task-tag-remove-${tag}`}
                aria-label={`${t('common.remove')}: ${tag}`}
                title={`${t('common.remove')}: ${tag}`}
                disabled={tags.length <= 1}
                onClick={() => onRemoveTag(tag)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <div className="settings-panel__input-row settings-task-tags__input">
          <input
            type="text"
            data-testid="settings-task-tag-add-input"
            aria-label={t('settingsPanel.tasks.addTagPlaceholder')}
            className="cove-field"
            value={addTaskTagInput}
            placeholder={t('settingsPanel.tasks.addTagPlaceholder')}
            onChange={event => onChangeAddTaskTagInput(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && onAddTag()}
          />
          <Button
            data-testid="settings-task-tag-add-button"
            disabled={addTaskTagInput.trim().length === 0}
            onClick={() => onAddTag()}
          >
            {t('common.add')}
          </Button>
        </div>
      </SettingsGroup>
    </>
  )
}
