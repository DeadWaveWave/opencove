import React from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  TASK_TITLE_PROVIDERS,
  type AgentProvider,
  type TaskTitleAgentProvider,
  type TaskTitleProvider,
} from '@contexts/settings/domain/agentSettings'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { SettingsGroup, SettingsGroupBody } from './SettingsGroup'

export function TaskConfigurationSection(props: {
  showTaskTitleGeneration: boolean
  defaultProvider: AgentProvider
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
    defaultProvider,
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
            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.tasks.titleProviderLabel')}</strong>
                <span>{t('settingsPanel.tasks.titleProviderHelp')}</span>
              </div>
              <div className="settings-panel__control">
                <CoveSelect
                  id="settings-task-title-provider"
                  testId="settings-task-title-provider"
                  ariaLabel={t('settingsPanel.tasks.titleProviderLabel')}
                  value={taskTitleProvider}
                  options={[
                    {
                      value: 'default',
                      label: t('settingsPanel.tasks.followDefaultAgent', {
                        provider: AGENT_PROVIDER_LABEL[defaultProvider],
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
              </div>
            </div>

            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.tasks.titleModelLabel')}</strong>
                <span>{t('settingsPanel.tasks.titleModelHelp')}</span>
              </div>
              <div className="settings-panel__control">
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
              </div>
            </div>

            <div className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{t('settingsPanel.tasks.effectiveProviderLabel')}</strong>
                <span>{t('settingsPanel.tasks.effectiveProviderHelp')}</span>
              </div>
              <div className="settings-panel__control">
                <span className="settings-panel__value">
                  {AGENT_PROVIDER_LABEL[effectiveTaskTitleProvider]}
                </span>
              </div>
            </div>
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
          <button
            type="button"
            className="primary"
            data-testid="settings-task-tag-add-button"
            disabled={addTaskTagInput.trim().length === 0}
            onClick={() => onAddTag()}
          >
            {t('common.add')}
          </button>
        </div>
      </SettingsGroup>
    </>
  )
}
