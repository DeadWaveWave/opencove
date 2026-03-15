import React, { type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import type { TaskPriority } from '../../../types'
import { TASK_PRIORITY_OPTIONS } from '../constants'
import { normalizeTaskTagSelection } from '../helpers'
import type { TaskEditorState } from '../types'
import { getTaskPriorityLabel } from '@app/renderer/i18n/labels'

interface TaskEditorWindowProps {
  taskEditor: TaskEditorState | null
  taskTitleProviderLabel: string
  taskTitleModelLabel: string
  taskTagOptions: string[]
  setTaskEditor: Dispatch<SetStateAction<TaskEditorState | null>>
  closeTaskEditor: () => void
  generateTaskEditorTitle: () => Promise<void>
  saveTaskEdits: () => Promise<void>
}

export function TaskEditorWindow({
  taskEditor,
  taskTitleProviderLabel,
  taskTitleModelLabel,
  taskTagOptions,
  setTaskEditor,
  closeTaskEditor,
  generateTaskEditorTitle,
  saveTaskEdits,
}: TaskEditorWindowProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const isTaskAiNamingEnabled = AI_NAMING_FEATURES.taskTitleGeneration

  if (!taskEditor) {
    return null
  }

  return (
    <div
      className="cove-window-backdrop workspace-task-creator-backdrop"
      onClick={() => {
        closeTaskEditor()
      }}
    >
      <section
        className="cove-window workspace-task-creator"
        data-testid="workspace-task-editor"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <h3>{t('taskWindow.editTask')}</h3>
        {isTaskAiNamingEnabled ? (
          <p className="workspace-task-creator__meta">
            {t('taskWindow.autoTaskProvider', {
              provider: taskTitleProviderLabel,
              model: taskTitleModelLabel,
            })}
          </p>
        ) : null}

        <div className="workspace-task-creator__field-row">
          <label htmlFor="workspace-task-editor-title">
            {isTaskAiNamingEnabled ? t('taskWindow.taskNameOptional') : t('taskWindow.taskName')}
          </label>
          <input
            id="workspace-task-editor-title"
            data-testid="workspace-task-editor-title"
            value={taskEditor.title}
            disabled={taskEditor.isSaving || taskEditor.isGeneratingTitle}
            placeholder={
              isTaskAiNamingEnabled
                ? t('taskWindow.leaveEmptyAutoGenerate')
                : t('taskWindow.enterTaskName')
            }
            onChange={event => {
              const nextValue = event.target.value
              setTaskEditor(prev =>
                prev
                  ? {
                      ...prev,
                      title: nextValue,
                      titleGeneratedInEditor: false,
                      error: null,
                    }
                  : prev,
              )
            }}
          />
        </div>

        <div className="workspace-task-creator__field-row">
          <label htmlFor="workspace-task-editor-requirement">
            {t('taskWindow.taskRequirementPrompt')}
          </label>
          <textarea
            id="workspace-task-editor-requirement"
            data-testid="workspace-task-editor-requirement"
            value={taskEditor.requirement}
            disabled={taskEditor.isSaving || taskEditor.isGeneratingTitle}
            placeholder={t('taskWindow.requirementPlaceholder')}
            onChange={event => {
              const nextValue = event.target.value
              setTaskEditor(prev =>
                prev
                  ? {
                      ...prev,
                      requirement: nextValue,
                      error: null,
                    }
                  : prev,
              )
            }}
          />
        </div>

        <div className="workspace-task-creator__field-grid">
          <div className="workspace-task-creator__field-row">
            <label htmlFor="workspace-task-editor-priority">{t('taskWindow.priority')}</label>
            <select
              id="workspace-task-editor-priority"
              data-testid="workspace-task-editor-priority"
              value={taskEditor.priority}
              disabled={taskEditor.isSaving || taskEditor.isGeneratingTitle}
              onChange={event => {
                const nextPriority = event.target.value as TaskPriority
                setTaskEditor(prev =>
                  prev
                    ? {
                        ...prev,
                        priority: nextPriority,
                      }
                    : prev,
                )
              }}
            >
              {TASK_PRIORITY_OPTIONS.map(option => (
                <option value={option.value} key={option.value}>
                  {getTaskPriorityLabel(t, option.value)}
                </option>
              ))}
            </select>
          </div>

          <div className="workspace-task-creator__field-row">
            <label>{t('taskWindow.tagsPreset')}</label>
            <div
              className="workspace-task-creator__tag-options"
              data-testid="workspace-task-editor-tag-options"
            >
              {taskTagOptions.length > 0 ? (
                taskTagOptions.map(tag => {
                  const checked = taskEditor.selectedTags.includes(tag)

                  return (
                    <label className="workspace-task-creator__tag-option" key={tag}>
                      <input
                        type="checkbox"
                        data-testid={`workspace-task-editor-tag-option-${tag}`}
                        checked={checked}
                        disabled={taskEditor.isSaving || taskEditor.isGeneratingTitle}
                        onChange={event => {
                          const isChecked = event.target.checked
                          setTaskEditor(prev => {
                            if (!prev) {
                              return prev
                            }

                            const nextSelected = isChecked
                              ? [...prev.selectedTags, tag]
                              : prev.selectedTags.filter(item => item !== tag)

                            return {
                              ...prev,
                              selectedTags: normalizeTaskTagSelection(nextSelected, taskTagOptions),
                            }
                          })
                        }}
                      />
                      <span>{tag}</span>
                    </label>
                  )
                })
              ) : (
                <span className="workspace-task-creator__hint">
                  {t('taskWindow.noTaskTagsConfigured')}
                </span>
              )}
            </div>
          </div>
        </div>

        {isTaskAiNamingEnabled ? (
          <label className="cove-window__checkbox workspace-task-creator__checkbox">
            <input
              type="checkbox"
              data-testid="workspace-task-editor-auto-generate-title"
              checked={taskEditor.autoGenerateTitle}
              disabled={taskEditor.isSaving || taskEditor.isGeneratingTitle}
              onChange={event => {
                setTaskEditor(prev =>
                  prev
                    ? {
                        ...prev,
                        autoGenerateTitle: event.target.checked,
                      }
                    : prev,
                )
              }}
            />
            <span>{t('taskWindow.autoGenerateWhenEmpty')}</span>
          </label>
        ) : null}

        {taskEditor.error ? (
          <p className="cove-window__error workspace-task-creator__error">{taskEditor.error}</p>
        ) : null}

        <div className="cove-window__actions workspace-task-creator__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost workspace-task-creator__action workspace-task-creator__action--ghost"
            data-testid="workspace-task-edit-cancel"
            disabled={taskEditor.isSaving || taskEditor.isGeneratingTitle}
            onClick={() => {
              closeTaskEditor()
            }}
          >
            {t('common.cancel')}
          </button>
          {isTaskAiNamingEnabled ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary workspace-task-creator__action workspace-task-creator__action--secondary"
              data-testid="workspace-task-edit-generate-title"
              disabled={taskEditor.isSaving || taskEditor.isGeneratingTitle}
              onClick={() => {
                void generateTaskEditorTitle()
              }}
            >
              {taskEditor.isGeneratingTitle ? t('common.generating') : t('common.generateByAi')}
            </button>
          ) : null}
          <button
            type="button"
            className="cove-window__action cove-window__action--primary workspace-task-creator__action workspace-task-creator__action--primary"
            data-testid="workspace-task-edit-submit"
            disabled={taskEditor.isSaving || taskEditor.isGeneratingTitle}
            onClick={() => {
              void saveTaskEdits()
            }}
          >
            {taskEditor.isSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </section>
    </div>
  )
}
