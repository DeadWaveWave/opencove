import React, { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { AI_NAMING_FEATURES } from '@shared/featureFlags/aiNaming'
import type { TaskPriority } from '../../../types'
import { TASK_PRIORITY_OPTIONS } from '../constants'
import { normalizeTaskTagSelection } from '../helpers'
import type { TaskCreatorState } from '../types'
import { getTaskPriorityLabel } from '@app/renderer/i18n/labels'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { FileText } from 'lucide-react'
import { TaskPromptTemplatesMenu } from '@contexts/task/presentation/renderer/components/promptTemplates/TaskPromptTemplatesMenu'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'

interface TaskCreatorWindowProps {
  taskCreator: TaskCreatorState | null
  taskTitleProviderLabel: string
  taskTitleModelLabel: string
  taskTagOptions: string[]
  setTaskCreator: Dispatch<SetStateAction<TaskCreatorState | null>>
  closeTaskCreator: () => void
  generateTaskTitle: () => Promise<void>
  createTask: () => Promise<void>
}

export function TaskCreatorWindow({
  taskCreator,
  taskTitleProviderLabel,
  taskTitleModelLabel,
  taskTagOptions,
  setTaskCreator,
  closeTaskCreator,
  generateTaskTitle,
  createTask,
}: TaskCreatorWindowProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const workspaceId = useAppStore(state => state.activeWorkspaceId)
  const [isAdvancedSettingsVisible, setIsAdvancedSettingsVisible] = useState(false)
  const [promptTemplatesMenuAnchor, setPromptTemplatesMenuAnchor] = useState<{
    x: number
    y: number
  } | null>(null)
  const promptTemplatesTriggerRef = useRef<HTMLButtonElement | null>(null)
  const isTaskAiNamingEnabled = AI_NAMING_FEATURES.taskTitleGeneration
  const isTaskCreatorOpen = taskCreator !== null
  const isPromptTemplatesMenuOpen = promptTemplatesMenuAnchor !== null

  useLayoutEffect(() => {
    if (isTaskCreatorOpen) {
      setIsAdvancedSettingsVisible(false)
      setPromptTemplatesMenuAnchor(null)
    }
  }, [isTaskCreatorOpen])

  if (!taskCreator) {
    return null
  }

  return (
    <div
      className="cove-window-backdrop workspace-task-creator-backdrop"
      onClick={() => {
        closeTaskCreator()
      }}
    >
      <section
        className="cove-window workspace-task-creator"
        data-testid="workspace-task-creator"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <h3>{t('taskWindow.newTask')}</h3>

        <div className="workspace-task-creator__field-row">
          <div className="cove-window__label-row">
            <label htmlFor="workspace-task-requirement">{t('taskWindow.describeTask')}</label>
            <button
              ref={promptTemplatesTriggerRef}
              type="button"
              className="cove-window__icon-button"
              data-testid="workspace-task-creator-open-prompt-templates"
              disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
              onClick={event => {
                event.stopPropagation()

                if (isPromptTemplatesMenuOpen) {
                  setPromptTemplatesMenuAnchor(null)
                  return
                }

                const rect = event.currentTarget.getBoundingClientRect()
                setPromptTemplatesMenuAnchor({
                  x: rect.right,
                  y: rect.bottom,
                })
              }}
              aria-label={t('taskPromptTemplates.openMenu')}
              title={t('taskPromptTemplates.openMenu')}
            >
              <FileText size={14} strokeWidth={2.2} />
            </button>
          </div>
          <textarea
            id="workspace-task-requirement"
            data-testid="workspace-task-requirement"
            value={taskCreator.requirement}
            autoFocus
            disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
            placeholder={t('taskWindow.requirementPlaceholder')}
            onChange={event => {
              const nextValue = event.target.value
              setTaskCreator(prev =>
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

        <TaskPromptTemplatesMenu
          isOpen={isPromptTemplatesMenuOpen}
          anchor={promptTemplatesMenuAnchor}
          workspaceId={workspaceId}
          closeMenu={() => {
            setPromptTemplatesMenuAnchor(null)
          }}
          triggerRef={promptTemplatesTriggerRef}
          currentRequirement={taskCreator.requirement}
          onChangeRequirement={nextRequirement => {
            setTaskCreator(prev =>
              prev
                ? {
                    ...prev,
                    requirement: nextRequirement,
                    error: null,
                  }
                : prev,
            )
          }}
          testIdPrefix="task-creator"
        />

        {isAdvancedSettingsVisible ? (
          <>
            {isTaskAiNamingEnabled ? (
              <p className="workspace-task-creator__meta">
                {t('taskWindow.autoTaskProvider', {
                  provider: taskTitleProviderLabel,
                  model: taskTitleModelLabel,
                })}
              </p>
            ) : null}

            <div className="workspace-task-creator__field-row">
              <label htmlFor="workspace-task-title">
                {isTaskAiNamingEnabled
                  ? t('taskWindow.taskNameOptional')
                  : t('taskWindow.taskNameOptionalSummary')}
              </label>
              <input
                id="workspace-task-title"
                data-testid="workspace-task-title"
                value={taskCreator.title}
                disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                placeholder={
                  isTaskAiNamingEnabled
                    ? t('taskWindow.leaveEmptyAutoGenerate')
                    : t('taskWindow.leaveEmptySummary')
                }
                onChange={event => {
                  const nextValue = event.target.value
                  setTaskCreator(prev =>
                    prev
                      ? {
                          ...prev,
                          title: nextValue,
                          error: null,
                        }
                      : prev,
                  )
                }}
              />
            </div>

            <div className="workspace-task-creator__field-grid">
              <div className="workspace-task-creator__field-row">
                <label htmlFor="workspace-task-priority">{t('taskWindow.priority')}</label>
                <CoveSelect
                  id="workspace-task-priority"
                  testId="workspace-task-priority"
                  value={taskCreator.priority}
                  disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                  options={TASK_PRIORITY_OPTIONS.map(option => ({
                    value: option.value,
                    label: getTaskPriorityLabel(t, option.value),
                  }))}
                  onChange={nextValue => {
                    const nextPriority = nextValue as TaskPriority
                    setTaskCreator(prev =>
                      prev
                        ? {
                            ...prev,
                            priority: nextPriority,
                          }
                        : prev,
                    )
                  }}
                />
              </div>

              <div className="workspace-task-creator__field-row">
                <label>{t('taskWindow.tagsPreset')}</label>
                <div
                  className="workspace-task-creator__tag-options"
                  data-testid="workspace-task-tag-options"
                >
                  {taskTagOptions.length > 0 ? (
                    taskTagOptions.map(tag => {
                      const checked = taskCreator.selectedTags.includes(tag)

                      return (
                        <label className="workspace-task-creator__tag-option" key={tag}>
                          <input
                            type="checkbox"
                            data-testid={`workspace-task-tag-option-${tag}`}
                            checked={checked}
                            disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                            onChange={event => {
                              const isChecked = event.target.checked
                              setTaskCreator(prev => {
                                if (!prev) {
                                  return prev
                                }

                                const nextSelected = isChecked
                                  ? [...prev.selectedTags, tag]
                                  : prev.selectedTags.filter(item => item !== tag)

                                return {
                                  ...prev,
                                  selectedTags: normalizeTaskTagSelection(
                                    nextSelected,
                                    taskTagOptions,
                                  ),
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
                  data-testid="workspace-task-auto-generate-title"
                  checked={taskCreator.autoGenerateTitle}
                  disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
                  onChange={event => {
                    setTaskCreator(prev =>
                      prev
                        ? {
                            ...prev,
                            autoGenerateTitle: event.target.checked,
                          }
                        : prev,
                    )
                  }}
                />
                <span>{t('taskWindow.autoFillByAi')}</span>
              </label>
            ) : null}
          </>
        ) : null}

        {taskCreator.error ? (
          <p className="cove-window__error workspace-task-creator__error">{taskCreator.error}</p>
        ) : null}

        <div className="cove-window__actions workspace-task-creator__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost workspace-task-creator__action workspace-task-creator__action--ghost workspace-task-creator__action--advanced-toggle"
            data-testid="workspace-task-advanced-toggle"
            disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
            onClick={() => {
              setIsAdvancedSettingsVisible(prev => !prev)
            }}
          >
            {isAdvancedSettingsVisible ? t('taskWindow.hideAdvanced') : t('taskWindow.advanced')}
          </button>
          {isAdvancedSettingsVisible && isTaskAiNamingEnabled ? (
            <button
              type="button"
              className="cove-window__action cove-window__action--secondary workspace-task-creator__action workspace-task-creator__action--secondary"
              data-testid="workspace-task-generate-title"
              disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
              onClick={() => {
                void generateTaskTitle()
              }}
            >
              {taskCreator.isGeneratingTitle ? t('common.generating') : t('common.generateByAi')}
            </button>
          ) : null}
          <button
            type="button"
            className="cove-window__action cove-window__action--primary workspace-task-creator__action workspace-task-creator__action--primary"
            data-testid="workspace-task-create-submit"
            disabled={taskCreator.isCreating || taskCreator.isGeneratingTitle}
            onClick={() => {
              void createTask()
            }}
          >
            {taskCreator.isCreating ? t('common.generating') : t('common.create')}
          </button>
        </div>
      </section>
    </div>
  )
}
