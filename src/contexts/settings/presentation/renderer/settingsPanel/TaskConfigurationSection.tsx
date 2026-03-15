import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDERS,
  AGENT_PROVIDER_LABEL,
  type AgentProvider,
  type TaskTitleProvider,
} from '@contexts/settings/domain/agentSettings'

export function TaskConfigurationSection(props: {
  showTaskTitleGeneration: boolean
  defaultProvider: AgentProvider
  taskTitleProvider: TaskTitleProvider
  taskTitleModel: string
  effectiveTaskTitleProvider: AgentProvider
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
    <div className="settings-panel__section" id="settings-section-task-configuration">
      <h3 className="settings-panel__section-title">{t('settingsPanel.tasks.title')}</h3>

      {props.showTaskTitleGeneration ? (
        <>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>{t('settingsPanel.tasks.titleProviderLabel')}</strong>
              <span>{t('settingsPanel.tasks.titleProviderHelp')}</span>
            </div>
            <div className="settings-panel__control">
              <select
                id="settings-task-title-provider"
                data-testid="settings-task-title-provider"
                value={taskTitleProvider}
                onChange={event => {
                  onChangeTaskTitleProvider(event.target.value as TaskTitleProvider)
                }}
              >
                <option value="default">
                  {t('settingsPanel.tasks.followDefaultAgent', {
                    provider: AGENT_PROVIDER_LABEL[defaultProvider],
                  })}
                </option>
                {AGENT_PROVIDERS.map(provider => (
                  <option value={provider} key={provider}>
                    {AGENT_PROVIDER_LABEL[provider]}
                  </option>
                ))}
              </select>
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
        </>
      ) : null}

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <strong>{t('settingsPanel.tasks.tagsLabel')}</strong>
          <span>{t('settingsPanel.tasks.tagsHelp')}</span>
        </div>

        <div className="settings-list-container" data-testid="settings-task-tag-list">
          {tags.map(tag => (
            <div className="settings-list-item" key={tag}>
              <span className="settings-panel__value">{tag}</span>
              <button
                type="button"
                className="secondary"
                style={{ padding: '2px 8px', fontSize: '11px' }}
                data-testid={`settings-task-tag-remove-${tag}`}
                disabled={tags.length <= 1}
                onClick={() => onRemoveTag(tag)}
              >
                {t('common.remove')}
              </button>
            </div>
          ))}
        </div>

        <div className="settings-panel__input-row">
          <input
            type="text"
            data-testid="settings-task-tag-add-input"
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
      </div>
    </div>
  )
}
