import React, { useCallback, useMemo, useState } from 'react'
import { FilePlus2, FileText } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { TaskPromptTemplate } from '@contexts/settings/domain/agentSettings'

type TemplateScope = 'global' | 'project'

function normalizeTemplateContentForInsert(templateContent: string, current: string): string {
  const prefix = templateContent.trim()
  const existing = current.trim()
  if (prefix.length === 0) {
    return existing
  }

  if (existing.length === 0) {
    return prefix
  }

  return `${prefix}\n\n${existing}`
}

function toTemplateNameKey(name: string): string {
  return name.trim().toLowerCase()
}

function createTemplate({ name, content }: { name: string; content: string }): TaskPromptTemplate {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    content: content.trim(),
    updatedAt: now,
  }
}

export function TaskPromptTemplatesMenu({
  isOpen,
  anchor,
  workspaceId,
  closeMenu,
  triggerRef,
  currentRequirement,
  onChangeRequirement,
  onRequestPersistFlush,
  testIdPrefix,
}: {
  isOpen: boolean
  anchor: { x: number; y: number } | null
  workspaceId: string | null
  closeMenu: () => void
  triggerRef?: React.RefObject<HTMLElement | null>
  currentRequirement: string
  onChangeRequirement: (nextRequirement: string) => void
  onRequestPersistFlush?: () => void
  testIdPrefix: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const templates = useAppStore(state => state.agentSettings.taskPromptTemplates)
  const templatesByWorkspaceId = useAppStore(
    state => state.agentSettings.taskPromptTemplatesByWorkspaceId,
  )
  const setAgentSettings = useAppStore(state => state.setAgentSettings)

  const [createScope, setCreateScope] = useState<TemplateScope | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const globalTemplates = useMemo(() => templates ?? [], [templates])
  const projectTemplates = useMemo(() => {
    if (!workspaceId) {
      return []
    }

    return templatesByWorkspaceId?.[workspaceId] ?? []
  }, [templatesByWorkspaceId, workspaceId])

  const globalNameKeys = useMemo(
    () => new Set(globalTemplates.map(tpl => toTemplateNameKey(tpl.name))),
    [globalTemplates],
  )
  const projectNameKeys = useMemo(
    () => new Set(projectTemplates.map(tpl => toTemplateNameKey(tpl.name))),
    [projectTemplates],
  )

  const openCreateDialog = useCallback(
    (scope: TemplateScope) => {
      setCreateScope(scope)
      setNameDraft('')
      setContentDraft('')
      setCreateError(null)
      setIsSaving(false)
      closeMenu()
    },
    [closeMenu],
  )

  const closeCreateDialog = useCallback(() => {
    setCreateScope(null)
    setCreateError(null)
    setIsSaving(false)
  }, [])

  const saveTemplate = useCallback(() => {
    if (!createScope) {
      return
    }

    if (isSaving) {
      return
    }

    const normalizedName = nameDraft.trim()
    const normalizedContent = contentDraft.trim()

    if (normalizedName.length === 0) {
      setCreateError(t('messages.taskPromptTemplateNameRequired'))
      return
    }

    if (normalizedContent.length === 0) {
      setCreateError(t('messages.taskPromptTemplateContentRequired'))
      return
    }

    if (createScope === 'global') {
      const key = toTemplateNameKey(normalizedName)
      if (globalNameKeys.has(key)) {
        setCreateError(t('messages.taskPromptTemplateNameTaken'))
        return
      }
    }

    if (createScope === 'project') {
      if (!workspaceId) {
        setCreateError(t('messages.taskPromptTemplateProjectUnavailable'))
        return
      }

      const key = toTemplateNameKey(normalizedName)
      if (projectNameKeys.has(key)) {
        setCreateError(t('messages.taskPromptTemplateNameTaken'))
        return
      }
    }

    setIsSaving(true)
    setCreateError(null)

    const template = createTemplate({ name: normalizedName, content: normalizedContent })

    setAgentSettings(prev => {
      if (createScope === 'global') {
        return {
          ...prev,
          taskPromptTemplates: [...prev.taskPromptTemplates, template],
        }
      }

      if (!workspaceId) {
        return prev
      }

      const existing = prev.taskPromptTemplatesByWorkspaceId[workspaceId] ?? []
      return {
        ...prev,
        taskPromptTemplatesByWorkspaceId: {
          ...prev.taskPromptTemplatesByWorkspaceId,
          [workspaceId]: [...existing, template],
        },
      }
    })

    onRequestPersistFlush?.()
    closeCreateDialog()
  }, [
    closeCreateDialog,
    contentDraft,
    createScope,
    globalNameKeys,
    isSaving,
    nameDraft,
    onRequestPersistFlush,
    projectNameKeys,
    setAgentSettings,
    t,
    workspaceId,
  ])

  const handleUseTemplate = useCallback(
    (templateContent: string) => {
      const nextRequirement = normalizeTemplateContentForInsert(templateContent, currentRequirement)
      if (nextRequirement.length === 0 || nextRequirement === currentRequirement.trim()) {
        return
      }

      onChangeRequirement(nextRequirement)
      closeMenu()
    },
    [closeMenu, currentRequirement, onChangeRequirement],
  )

  const menu = useMemo(() => {
    if (!isOpen || !anchor) {
      return null
    }

    return (
      <ViewportMenuSurface
        open={isOpen}
        className="workspace-context-menu task-prompt-template-menu"
        data-testid={`${testIdPrefix}-prompt-templates-menu`}
        placement={{
          type: 'point',
          point: anchor,
          alignX: 'auto',
          alignY: 'auto',
          estimatedSize: {
            width: 240,
            height: 320,
          },
        }}
        onDismiss={closeMenu}
        dismissOnPointerDownOutside={true}
        dismissOnEscape={true}
        dismissIgnoreRefs={triggerRef ? [triggerRef] : []}
        style={{
          zIndex: 25,
        }}
      >
        <div className="workspace-context-menu__section-title">
          {t('taskPromptTemplates.globalSection')}
        </div>

        {globalTemplates.length > 0 ? (
          globalTemplates.map(template => (
            <button
              key={template.id}
              type="button"
              data-testid={`${testIdPrefix}-prompt-templates-use-global-${template.id}`}
              onClick={() => {
                handleUseTemplate(template.content)
              }}
            >
              <FileText className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">{template.name}</span>
            </button>
          ))
        ) : (
          <button type="button" disabled>
            <FileText className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('taskPromptTemplates.noGlobalTemplates')}
            </span>
          </button>
        )}

        <button
          type="button"
          data-testid={`${testIdPrefix}-prompt-templates-add-global`}
          onClick={() => {
            openCreateDialog('global')
          }}
        >
          <FilePlus2 className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('taskPromptTemplates.addGlobal')}
          </span>
        </button>

        <div className="workspace-context-menu__separator" />

        <div className="workspace-context-menu__section-title">
          {t('taskPromptTemplates.projectSection')}
        </div>

        {projectTemplates.length > 0 ? (
          projectTemplates.map(template => (
            <button
              key={template.id}
              type="button"
              data-testid={`${testIdPrefix}-prompt-templates-use-project-${template.id}`}
              onClick={() => {
                handleUseTemplate(template.content)
              }}
            >
              <FileText className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">{template.name}</span>
            </button>
          ))
        ) : (
          <button type="button" disabled>
            <FileText className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {workspaceId
                ? t('taskPromptTemplates.noProjectTemplates')
                : t('taskPromptTemplates.projectUnavailable')}
            </span>
          </button>
        )}

        <button
          type="button"
          data-testid={`${testIdPrefix}-prompt-templates-add-project`}
          disabled={!workspaceId}
          onClick={() => {
            openCreateDialog('project')
          }}
        >
          <FilePlus2 className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('taskPromptTemplates.addProject')}
          </span>
        </button>
      </ViewportMenuSurface>
    )
  }, [
    anchor,
    globalTemplates,
    handleUseTemplate,
    isOpen,
    openCreateDialog,
    projectTemplates,
    closeMenu,
    t,
    testIdPrefix,
    triggerRef,
    workspaceId,
  ])

  if (!isOpen && !createScope) {
    return null
  }

  return (
    <>
      {menu}

      {createScope ? (
        <div
          className="cove-window-backdrop task-prompt-template-create-backdrop"
          data-testid={`${testIdPrefix}-prompt-templates-create-window`}
          onClick={() => {
            closeCreateDialog()
          }}
        >
          <section
            className="cove-window task-prompt-template-create"
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <h3>
              {createScope === 'global'
                ? t('taskPromptTemplates.createGlobalTitle')
                : t('taskPromptTemplates.createProjectTitle')}
            </h3>
            <p className="cove-window__meta">{t('taskPromptTemplates.createDescription')}</p>

            <div className="cove-window__field-row">
              <label htmlFor={`${testIdPrefix}-prompt-template-name`}>
                {t('taskPromptTemplates.templateName')}
              </label>
              <input
                id={`${testIdPrefix}-prompt-template-name`}
                data-testid={`${testIdPrefix}-prompt-templates-create-name`}
                value={nameDraft}
                disabled={isSaving}
                placeholder={t('taskPromptTemplates.templateNamePlaceholder')}
                onChange={event => {
                  setNameDraft(event.target.value)
                  setCreateError(null)
                }}
              />
            </div>

            <div className="cove-window__field-row">
              <label htmlFor={`${testIdPrefix}-prompt-template-content`}>
                {t('taskPromptTemplates.templateContent')}
              </label>
              <textarea
                id={`${testIdPrefix}-prompt-template-content`}
                data-testid={`${testIdPrefix}-prompt-templates-create-content`}
                value={contentDraft}
                disabled={isSaving}
                placeholder={t('taskPromptTemplates.templateContentPlaceholder')}
                onChange={event => {
                  setContentDraft(event.target.value)
                  setCreateError(null)
                }}
              />
            </div>

            {createError ? <p className="cove-window__error">{createError}</p> : null}

            <div className="cove-window__actions">
              <button
                type="button"
                className="cove-window__action cove-window__action--ghost"
                data-testid={`${testIdPrefix}-prompt-templates-create-cancel`}
                disabled={isSaving}
                onClick={() => {
                  closeCreateDialog()
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="cove-window__action cove-window__action--primary"
                data-testid={`${testIdPrefix}-prompt-templates-create-save`}
                disabled={isSaving}
                onClick={() => {
                  saveTemplate()
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
