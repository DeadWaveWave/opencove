import React from 'react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Group,
  LayoutGrid,
  ListTodo,
  LoaderCircle,
  Magnet,
  Play,
  SlidersHorizontal,
  Tag,
  Terminal,
  X,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, type AgentProvider } from '@contexts/settings/domain/agentSettings'
import { LABEL_COLORS, type NodeLabelColorOverride } from '@shared/types/labelColor'

function renderMark(checked: boolean): React.JSX.Element {
  return checked ? (
    <Check className="workspace-context-menu__mark" aria-hidden="true" />
  ) : (
    <span className="workspace-context-menu__mark" aria-hidden="true" />
  )
}

export function WorkspaceContextPaneMenuContent({
  createTerminalNode,
  createNoteNodeFromContextMenu,
  openTaskCreator,
  openAgentLauncher,
  openAgentProviderSubmenu,
  agentProviderToggleRef,
  isLoadingInstalledProviders,
  isAgentProviderSubmenuOpen,
  canArrangeCurrentScope,
  commitArrangeAndClose,
  arrangeByButtonRef,
  openArrangeSubmenu,
  isArrangeSubmenuOpen,
  magneticSnappingEnabled,
  onToggleMagneticSnapping,
}: {
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  openTaskCreator: () => void
  openAgentLauncher: () => void
  openAgentProviderSubmenu: () => void
  agentProviderToggleRef: React.RefObject<HTMLButtonElement | null>
  isLoadingInstalledProviders: boolean
  isAgentProviderSubmenuOpen: boolean
  canArrangeCurrentScope: boolean
  commitArrangeAndClose: () => void
  arrangeByButtonRef: React.RefObject<HTMLButtonElement | null>
  openArrangeSubmenu: () => void
  isArrangeSubmenuOpen: boolean
  magneticSnappingEnabled: boolean
  onToggleMagneticSnapping: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <button
        type="button"
        data-testid="workspace-context-new-terminal"
        onClick={() => {
          void createTerminalNode()
        }}
      >
        <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceContextMenu.newTerminal')}
        </span>
      </button>
      <button
        type="button"
        data-testid="workspace-context-new-note"
        onClick={() => {
          createNoteNodeFromContextMenu()
        }}
      >
        <FileText className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.newNote')}</span>
      </button>
      <button
        type="button"
        data-testid="workspace-context-new-task"
        onClick={() => {
          openTaskCreator()
        }}
      >
        <ListTodo className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.newTask')}</span>
      </button>

      <div className="workspace-context-menu__split">
        <button
          type="button"
          data-testid="workspace-context-run-default-agent"
          className="workspace-context-menu__split-main"
          onClick={openAgentLauncher}
        >
          <Play className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('workspaceContextMenu.runAgent')}
          </span>
        </button>
        <button
          ref={agentProviderToggleRef}
          type="button"
          data-testid="workspace-context-run-agent-provider-toggle"
          className="workspace-context-menu__split-toggle"
          aria-label={t('workspaceContextMenu.runAgent')}
          onMouseEnter={openAgentProviderSubmenu}
          onFocus={openAgentProviderSubmenu}
          onClick={openAgentProviderSubmenu}
        >
          {isLoadingInstalledProviders ? (
            <LoaderCircle
              className="workspace-context-menu__icon workspace-context-menu__spinner"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className={`workspace-context-menu__icon workspace-context-menu__chevron ${
                isAgentProviderSubmenuOpen ? 'workspace-context-menu__chevron--open' : ''
              }`}
              aria-hidden="true"
            />
          )}
        </button>
      </div>

      <div className="workspace-context-menu__separator" />

      <button
        type="button"
        data-testid="workspace-context-arrange"
        disabled={!canArrangeCurrentScope}
        onClick={commitArrangeAndClose}
      >
        <LayoutGrid className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.arrange')}</span>
      </button>

      <button
        ref={arrangeByButtonRef}
        type="button"
        data-testid="workspace-context-arrange-by"
        aria-haspopup="menu"
        aria-expanded={isArrangeSubmenuOpen}
        onMouseEnter={openArrangeSubmenu}
        onFocus={openArrangeSubmenu}
        onClick={openArrangeSubmenu}
      >
        <SlidersHorizontal className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('workspaceContextMenu.arrangeBy')}</span>
        <ChevronRight
          className={`workspace-context-menu__icon workspace-context-menu__chevron ${
            isArrangeSubmenuOpen ? 'workspace-context-menu__chevron--open' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      <button
        type="button"
        data-testid="workspace-context-magnetic-snapping"
        onClick={onToggleMagneticSnapping}
      >
        <Magnet className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.magneticSnapping')}
        </span>
        {renderMark(magneticSnappingEnabled)}
      </button>
    </>
  )
}

export function WorkspaceContextSelectionMenuContent({
  createSpaceFromSelectedNodes,
  openLabelColorSubmenu,
  labelColorButtonRef,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
  clearNodeSelection,
  closeContextMenu,
}: {
  createSpaceFromSelectedNodes: () => void
  openLabelColorSubmenu: () => void
  labelColorButtonRef: React.RefObject<HTMLButtonElement | null>
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
  clearNodeSelection: () => void
  closeContextMenu: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <button
        type="button"
        data-testid="workspace-selection-create-space"
        onClick={createSpaceFromSelectedNodes}
      >
        <Group className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceContextMenu.createSpaceWithSelected')}
        </span>
      </button>
      {canConvertSelectedNoteToTask ? (
        <button
          type="button"
          data-testid="workspace-selection-convert-note-to-task"
          disabled={isConvertSelectedNoteToTaskDisabled}
          onClick={convertSelectedNoteToTask}
        >
          <ArrowRight className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">
            {t('workspaceContextMenu.convertToTask')}
          </span>
        </button>
      ) : null}
      <button
        ref={labelColorButtonRef}
        type="button"
        data-testid="workspace-selection-label-color"
        onMouseEnter={openLabelColorSubmenu}
        onFocus={openLabelColorSubmenu}
        onClick={openLabelColorSubmenu}
      >
        <Tag className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('labelColors.title')}</span>
        <ChevronRight
          className="workspace-context-menu__icon workspace-context-menu__chevron"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        data-testid="workspace-selection-clear"
        onClick={() => {
          clearNodeSelection()
          closeContextMenu()
        }}
      >
        <X className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">
          {t('workspaceContextMenu.clearSelection')}
        </span>
      </button>
    </>
  )
}

export function WorkspaceContextAgentProviderSubmenu({
  sortedInstalledProviders,
  submenuRef,
  style,
  keepSubmenuOpen,
  scheduleSubmenuClose,
  openAgentLauncherForProvider,
}: {
  sortedInstalledProviders: AgentProvider[]
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  openAgentLauncherForProvider: (provider: AgentProvider) => void
}): React.JSX.Element {
  return (
    <ViewportMenuSurface
      open={true}
      ref={submenuRef}
      className="workspace-context-menu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-context-run-agent-provider-menu"
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
      {sortedInstalledProviders.map(provider => (
        <button
          key={provider}
          type="button"
          data-testid={`workspace-context-run-agent-${provider}`}
          onClick={() => {
            openAgentLauncherForProvider(provider)
          }}
        >
          <Play className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">{AGENT_PROVIDER_LABEL[provider]}</span>
        </button>
      ))}
    </ViewportMenuSurface>
  )
}

export function WorkspaceContextLabelColorSubmenu({
  submenuRef,
  style,
  keepSubmenuOpen,
  scheduleSubmenuClose,
  setSelectedNodeLabelColorOverride,
  closeContextMenu,
}: {
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  keepSubmenuOpen: () => void
  scheduleSubmenuClose: () => void
  setSelectedNodeLabelColorOverride: (labelColorOverride: NodeLabelColorOverride) => void
  closeContextMenu: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ViewportMenuSurface
      open={true}
      ref={submenuRef}
      className="workspace-context-menu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-selection-label-color-menu"
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
      <button
        type="button"
        data-testid="workspace-selection-label-color-auto-inherit"
        onClick={() => {
          setSelectedNodeLabelColorOverride(null)
          closeContextMenu()
        }}
      >
        <span
          className="workspace-context-menu__icon workspace-label-color-menu__dot workspace-label-color-menu__dot--auto"
          aria-hidden="true"
        />
        <span className="workspace-context-menu__label">{t('labelColors.autoInherit')}</span>
      </button>

      <button
        type="button"
        data-testid="workspace-selection-label-color-none"
        onClick={() => {
          setSelectedNodeLabelColorOverride('none')
          closeContextMenu()
        }}
      >
        <span
          className="workspace-context-menu__icon workspace-label-color-menu__dot workspace-label-color-menu__dot--none"
          aria-hidden="true"
        />
        <span className="workspace-context-menu__label">{t('labelColors.none')}</span>
      </button>

      {LABEL_COLORS.map(color => (
        <button
          key={color}
          type="button"
          data-testid={`workspace-selection-label-color-${color}`}
          onClick={() => {
            setSelectedNodeLabelColorOverride(color)
            closeContextMenu()
          }}
        >
          <span
            className="workspace-context-menu__icon workspace-label-color-menu__dot"
            data-cove-label-color={color}
            aria-hidden="true"
          />
          <span className="workspace-context-menu__label">{t(`labelColors.${color}`)}</span>
        </button>
      ))}
    </ViewportMenuSurface>
  )
}
