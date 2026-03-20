import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  TASK_TITLE_PROVIDERS,
  type AgentProvider,
  type TaskTitleAgentProvider,
  type TaskTitleProvider,
} from '@contexts/settings/domain/agentSettings'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

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
              <CoveSelect
                id="settings-task-title-provider"
                testId="settings-task-title-provider"
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
      </div>
    </div>
  )
}
