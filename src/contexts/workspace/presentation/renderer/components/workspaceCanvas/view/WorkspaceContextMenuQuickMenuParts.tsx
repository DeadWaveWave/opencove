import React from 'react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { ChevronRight, FileText, Globe, Settings, Terminal } from 'lucide-react'
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
      <div className="workspace-context-menu__separator" />

      {pinnedQuickCommands.map(command => (
        <button
          key={command.id}
          type="button"
          data-testid={`workspace-context-quick-command-pinned-${command.id}`}
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

      <button
        ref={quickCommandsButtonRef}
        type="button"
        data-testid="workspace-context-quick-commands"
        aria-haspopup="menu"
        aria-expanded={isQuickCommandsSubmenuOpen}
        onMouseEnter={openQuickCommandsSubmenu}
        onFocus={openQuickCommandsSubmenu}
        onClick={openQuickCommandsSubmenu}
      >
        <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('settingsPanel.quickMenu.commands.title')}
        </span>
        <ChevronRight
          className={`workspace-context-menu__icon workspace-context-menu__chevron ${
            isQuickCommandsSubmenuOpen ? 'workspace-context-menu__chevron--open' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      <button
        ref={quickPhrasesButtonRef}
        type="button"
        data-testid="workspace-context-quick-phrases"
        aria-haspopup="menu"
        aria-expanded={isQuickPhrasesSubmenuOpen}
        onMouseEnter={openQuickPhrasesSubmenu}
        onFocus={openQuickPhrasesSubmenu}
        onClick={openQuickPhrasesSubmenu}
      >
        <FileText className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('settingsPanel.quickMenu.phrases.title')}
        </span>
        <ChevronRight
          className={`workspace-context-menu__icon workspace-context-menu__chevron ${
            isQuickPhrasesSubmenuOpen ? 'workspace-context-menu__chevron--open' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      <button
        type="button"
        data-testid="workspace-context-customize-quick-menu"
        onClick={() => {
          openQuickMenuSettings()
        }}
      >
        <Settings className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('settingsPanel.quickMenu.customize')}
        </span>
      </button>

      <div className="workspace-context-menu__separator" />
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
}: {
  commands: QuickCommand[]
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  runQuickCommand: (command: QuickCommand) => Promise<void>
  openQuickMenuSettings: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ViewportMenuSurface
      open={true}
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
      onMouseEnter={keepSubmenuOpen}
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
}: {
  phrases: QuickPhrase[]
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  insertQuickPhrase: (phrase: QuickPhrase) => void
  openQuickMenuSettings: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ViewportMenuSurface
      open={true}
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
      onMouseEnter={keepSubmenuOpen}
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
