import React from 'react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { menuHoverHandler } from '@app/renderer/components/menuHoverHandler'
import { MenuItem, MenuSeparator } from '@app/renderer/components/ui/Menu'
import { FileText, Globe, Settings, Terminal } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { QuickCommand, QuickPhrase } from '@contexts/settings/domain/agentSettings'

export function WorkspaceContextQuickMenuItems({
  pinnedQuickCommands,
  runQuickCommand,
  quickCommandsButtonRef,
  openQuickCommandsSubmenu,
  isQuickCommandsSubmenuOpen,
  quickPhrasesButtonRef,
  openQuickPhrasesSubmenu,
  isQuickPhrasesSubmenuOpen,
  openQuickMenuSettings,
}: {
  pinnedQuickCommands: QuickCommand[]
  runQuickCommand: (command: QuickCommand) => Promise<void>
  quickCommandsButtonRef: React.RefObject<HTMLButtonElement | null>
  openQuickCommandsSubmenu: () => void
  isQuickCommandsSubmenuOpen: boolean
  quickPhrasesButtonRef: React.RefObject<HTMLButtonElement | null>
  openQuickPhrasesSubmenu: () => void
  isQuickPhrasesSubmenuOpen: boolean
  openQuickMenuSettings: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <MenuSeparator />

      {pinnedQuickCommands.map(command => (
        <MenuItem
          key={command.id}
          icon={command.kind === 'terminal' ? <Terminal /> : <Globe />}
          data-testid={`workspace-context-quick-command-pinned-${command.id}`}
          onClick={() => {
            void runQuickCommand(command)
          }}
        >
          {command.title}
        </MenuItem>
      ))}

      <MenuItem
        ref={quickCommandsButtonRef}
        icon={<Terminal />}
        data-testid="workspace-context-quick-commands"
        submenu={{ open: isQuickCommandsSubmenuOpen }}
        onMouseEnter={menuHoverHandler(openQuickCommandsSubmenu)}
        onClick={openQuickCommandsSubmenu}
      >
        {t('settingsPanel.quickMenu.commands.title')}
      </MenuItem>

      <MenuItem
        ref={quickPhrasesButtonRef}
        icon={<FileText />}
        data-testid="workspace-context-quick-phrases"
        submenu={{ open: isQuickPhrasesSubmenuOpen }}
        onMouseEnter={menuHoverHandler(openQuickPhrasesSubmenu)}
        onClick={openQuickPhrasesSubmenu}
      >
        {t('settingsPanel.quickMenu.phrases.title')}
      </MenuItem>

      <MenuItem
        icon={<Settings />}
        data-testid="workspace-context-customize-quick-menu"
        onClick={() => {
          openQuickMenuSettings()
        }}
      >
        {t('settingsPanel.quickMenu.customize')}
      </MenuItem>

      <MenuSeparator />
    </>
  )
}

export function WorkspaceContextQuickCommandsSubmenu({
  commands,
  submenuRef,
  style,
  keepSubmenuOpen,
  scheduleSubmenuClose,
  runQuickCommand,
  openQuickMenuSettings,
  onBack,
  onDismiss,
}: {
  commands: QuickCommand[]
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  runQuickCommand: (command: QuickCommand) => Promise<void>
  openQuickMenuSettings: () => void
  onBack: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ViewportMenuSurface
      open={true}
      mobileTitle={t('settingsPanel.quickMenu.commands.title')}
      isSubmenu
      onBack={onBack}
      onDismiss={onDismiss}
      ref={submenuRef}
      className="workspace-context-menu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-context-quick-commands-menu"
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
      {commands.map(command => (
        <button
          key={command.id}
          type="button"
          data-testid={`workspace-context-quick-command-${command.id}`}
          onClick={() => {
            void runQuickCommand(command)
          }}
        >
          {command.kind === 'terminal' ? (
            <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
          ) : (
            <Globe className="workspace-context-menu__icon" aria-hidden="true" />
          )}
          <span className="workspace-context-menu__label">{command.title}</span>
        </button>
      ))}

      {commands.length > 0 ? <div className="workspace-context-menu__separator" /> : null}

      <button
        type="button"
        data-testid="workspace-context-quick-commands-customize"
        onClick={openQuickMenuSettings}
      >
        <Settings className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('settingsPanel.quickMenu.customize')}
        </span>
      </button>
    </ViewportMenuSurface>
  )
}

export function WorkspaceContextQuickPhrasesSubmenu({
  phrases,
  submenuRef,
  style,
  keepSubmenuOpen,
  scheduleSubmenuClose,
  insertQuickPhrase,
  openQuickMenuSettings,
  onBack,
  onDismiss,
}: {
  phrases: QuickPhrase[]
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  insertQuickPhrase: (phrase: QuickPhrase) => void
  openQuickMenuSettings: () => void
  onBack: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ViewportMenuSurface
      open={true}
      mobileTitle={t('settingsPanel.quickMenu.phrases.title')}
      isSubmenu
      onBack={onBack}
      onDismiss={onDismiss}
      ref={submenuRef}
      className="workspace-context-menu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-context-quick-phrases-menu"
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
      {phrases.map(phrase => (
        <button
          key={phrase.id}
          type="button"
          data-testid={`workspace-context-quick-phrase-${phrase.id}`}
          onClick={() => {
            insertQuickPhrase(phrase)
          }}
        >
          <FileText className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">{phrase.title}</span>
        </button>
      ))}

      {phrases.length > 0 ? <div className="workspace-context-menu__separator" /> : null}

      <button
        type="button"
        data-testid="workspace-context-quick-phrases-customize"
        onClick={openQuickMenuSettings}
      >
        <Settings className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('settingsPanel.quickMenu.customize')}
        </span>
      </button>
    </ViewportMenuSurface>
  )
}
