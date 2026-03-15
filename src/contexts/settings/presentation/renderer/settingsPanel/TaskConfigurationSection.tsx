import React from 'react'
import {
  AGENT_PROVIDER_LABEL,
  TASK_TITLE_PROVIDERS,
  type AgentProvider,
  type TaskTitleAgentProvider,
  type TaskTitleProvider,
} from '@contexts/settings/domain/agentSettings'

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
      <h3 className="settings-panel__section-title">Task Configuration</h3>

      {props.showTaskTitleGeneration ? (
        <>
          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>Title Provider</strong>
              <span>Provider used when OpenCove generates a title for a new task.</span>
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
                  Follow Default Agent ({AGENT_PROVIDER_LABEL[defaultProvider]})
                </option>
                {TASK_TITLE_PROVIDERS.map(provider => (
                  <option value={provider} key={provider}>
                    {AGENT_PROVIDER_LABEL[provider]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>Title Model</strong>
              <span>Optional override for task title generation.</span>
            </div>
            <div className="settings-panel__control">
              <input
                type="text"
                id="settings-task-title-model"
                data-testid="settings-task-title-model"
                value={taskTitleModel}
                placeholder="Follow CLI default"
                onChange={event => {
                  onChangeTaskTitleModel(event.target.value)
                }}
              />
            </div>
          </div>

          <div className="settings-panel__row">
            <div className="settings-panel__row-label">
              <strong>Effective Provider</strong>
              <span>Resolved provider after applying the default fallback.</span>
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
          <strong>Task Tags</strong>
          <span>Common tags used to categorize and filter tasks.</span>
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
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="settings-panel__input-row">
          <input
            type="text"
            data-testid="settings-task-tag-add-input"
            value={addTaskTagInput}
            placeholder="Add tag"
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
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
