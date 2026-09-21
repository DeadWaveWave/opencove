import React from 'react'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { useTranslation } from '@app/renderer/i18n'
import type { PrimarySidebarController } from '../hooks/usePrimarySidebar'
import { Sidebar } from './Sidebar'

export function AppPrimarySidebar({
  controller,
  isMenuOpen,
  triggerRef,
  ...sidebarProps
}: Omit<React.ComponentProps<typeof Sidebar>, 'variant'> & {
  controller: PrimarySidebarController
  isMenuOpen: boolean
  triggerRef: React.RefObject<HTMLButtonElement | null>
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const sidebar = (
    <Sidebar
      {...sidebarProps}
      isMenuOpen={isMenuOpen}
      variant={controller.variant}
      isMobile={controller.isMobile}
      onClose={controller.close}
      onInteractionActiveChange={controller.setDragging}
      onPointerEnter={controller.onPointerEnter}
      onPointerLeave={controller.onPointerLeave}
    />
  )

  if (!controller.isMobile) {
    return sidebar
  }

  return (
    <Dialog
      open={controller.isDrawerOpen}
      onDismiss={controller.close}
      className="primary-sidebar-drawer"
      backdropClassName="primary-sidebar-backdrop"
      backdropTestId="primary-sidebar-backdrop"
      data-testid="primary-sidebar-drawer"
      id="primary-sidebar-navigation"
      aria-label={t('commandCenter.sidebar')}
      returnFocus={triggerRef}
      inertRootSelector=".workspace-main, .settings-page, .app-header"
      focusOutsideSelectors={[
        '.workspace-project-context-menu',
        '.workspace-sidebar__filter-options',
      ]}
      dismissOnPointerDownOutside={!isMenuOpen}
      dismissOnEscape={!isMenuOpen}
    >
      {sidebar}
    </Dialog>
  )
}
