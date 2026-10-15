import React from 'react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { menuHoverHandler } from '@app/renderer/components/menuHoverHandler'
import { MenuItem } from '@app/renderer/components/ui/Menu'
import { Bot, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { ProjectRoleDefinition } from '@contexts/settings/domain/agentSettings'

export function WorkspaceContextRoleMenuItems({
  roleButtonRef,
  openProjectRolesSubmenu,
  isProjectRolesSubmenuOpen,
}: {
  roleButtonRef: React.RefObject<HTMLButtonElement | null>
  openProjectRolesSubmenu: () => void
  isProjectRolesSubmenuOpen: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <MenuItem
      ref={roleButtonRef}
      icon={<Bot />}
      data-testid="workspace-context-run-role"
      submenu={{ open: isProjectRolesSubmenuOpen }}
      onMouseEnter={menuHoverHandler(openProjectRolesSubmenu)}
      onClick={openProjectRolesSubmenu}
    >
      {t('workspaceContextMenu.runRole')}
    </MenuItem>
  )
}

export function WorkspaceContextProjectRolesSubmenu({
  projectRoles,
  submenuRef,
  style,
  keepSubmenuOpen,
  scheduleSubmenuClose,
  runProjectRoleFromContextMenu,
  openRoleCreator,
  openRoleEditor,
  deleteProjectRole,
  onBack,
  onDismiss,
}: {
  projectRoles: ProjectRoleDefinition[]
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  runProjectRoleFromContextMenu: (roleId: string) => void
  openRoleCreator: () => void
  openRoleEditor: (roleId: string) => void
  deleteProjectRole: (roleId: string) => void
  onBack: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [activeActionsRoleId, setActiveActionsRoleId] = React.useState<string | null>(null)
  const [pendingDeleteRoleId, setPendingDeleteRoleId] = React.useState<string | null>(null)

  return (
    <ViewportMenuSurface
      open={true}
      mobileTitle={t('workspaceContextMenu.runRole')}
      isSubmenu
      onBack={onBack}
      onDismiss={onDismiss}
      ref={submenuRef}
      className="workspace-context-menu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-context-run-role-menu"
      placement={{
        type: 'absolute',
        top: style.top as number,
        left: style.left as number,
      }}
      style={{
        maxHeight: style.maxHeight,
      }}
      onMouseEnter={menuHoverHandler(keepSubmenuOpen)}
      onMouseLeave={scheduleSubmenuClose}
    >
      {projectRoles.length > 0 ? (
        projectRoles.map(role => (
          <React.Fragment key={role.id}>
            <div className="workspace-context-menu__split workspace-context-menu__role-row">
              <button
                type="button"
                className="workspace-context-menu__split-main"
                data-testid={`workspace-context-run-role-${role.id}`}
                onClick={() => {
                  runProjectRoleFromContextMenu(role.id)
                }}
              >
                <Bot className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">{role.name}</span>
              </button>
              <button
                type="button"
                className="workspace-context-menu__split-toggle"
                data-testid={`workspace-context-run-role-more-${role.id}`}
                aria-label={t('roleActions.more')}
                aria-expanded={activeActionsRoleId === role.id}
                onClick={event => {
                  event.stopPropagation()
                  setPendingDeleteRoleId(null)
                  setActiveActionsRoleId(current => (current === role.id ? null : role.id))
                }}
              >
                <MoreHorizontal
                  className="workspace-context-menu__icon workspace-context-menu__more"
                  aria-hidden="true"
                />
              </button>
            </div>
            {activeActionsRoleId === role.id ? (
              <div className="workspace-context-menu__role-actions">
                <button
                  type="button"
                  data-testid={`workspace-context-edit-role-${role.id}`}
                  onClick={event => {
                    event.stopPropagation()
                    openRoleEditor(role.id)
                  }}
                >
                  <Pencil className="workspace-context-menu__icon" aria-hidden="true" />
                  <span className="workspace-context-menu__label">{t('common.edit')}</span>
                </button>
                <button
                  type="button"
                  data-testid={`workspace-context-delete-role-${role.id}`}
                  className="workspace-context-menu__item--danger"
                  onClick={event => {
                    event.stopPropagation()
                    if (pendingDeleteRoleId === role.id) {
                      deleteProjectRole(role.id)
                      return
                    }

                    setPendingDeleteRoleId(role.id)
                  }}
                >
                  <Trash2 className="workspace-context-menu__icon" aria-hidden="true" />
                  <span className="workspace-context-menu__label">
                    {pendingDeleteRoleId === role.id
                      ? t('roleActions.confirmDelete')
                      : t('common.delete')}
                  </span>
                </button>
              </div>
            ) : null}
          </React.Fragment>
        ))
      ) : (
        <button type="button" data-testid="workspace-context-run-role-empty" disabled>
          <Bot className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('workspaceContextMenu.noProjectRoles')}
          </span>
        </button>
      )}
      <div className="workspace-context-menu__separator" />
      <button
        type="button"
        data-testid="workspace-context-new-role"
        onClick={() => {
          openRoleCreator()
        }}
      >
        <Plus className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.newRole')}</span>
      </button>
    </ViewportMenuSurface>
  )
}
