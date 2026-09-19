import React, { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { Popover } from '@app/renderer/components/ui/Popover'
import { useTranslation } from '@app/renderer/i18n'
import { AGENT_PROVIDER_LABEL, AGENT_PROVIDERS } from '@contexts/settings/domain/agentSettings'
import {
  DEFAULT_SIDEBAR_VIEW_FILTERS,
  normalizeSidebarViewSettings,
  type SidebarViewFilters,
} from '@contexts/settings/domain/sidebarViewSettings'

export function SidebarViewControls({
  filters,
  hiddenWaitingCount,
  isMobile,
  onChange,
  onOpenChange,
}: {
  filters: SidebarViewFilters
  hiddenWaitingCount: number
  isMobile: boolean
  onChange: (filters: SidebarViewFilters) => void
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const hasFilter =
    filters.status !== 'all' || filters.provider !== 'all' || filters.visibility !== 'visible'
  useEffect(() => {
    onOpenChange(isOpen)
    if (isOpen) {
      document.getElementById(`${panelId}-status`)?.focus()
    }
    return () => onOpenChange(false)
  }, [isOpen, onOpenChange, panelId])

  const update = (field: keyof SidebarViewFilters, value: string): void => {
    onChange(normalizeSidebarViewSettings({ filters: { ...filters, [field]: value } }).filters)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-sidebar__more workspace-sidebar__filter"
        data-testid="workspace-sidebar-filter"
        data-active={hasFilter || undefined}
        aria-label={t('sidebar.filters')}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        title={
          hiddenWaitingCount > 0
            ? t('sidebar.hiddenAttention', { count: hiddenWaitingCount })
            : t('sidebar.filters')
        }
        onClick={() => setIsOpen(open => !open)}
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        {hiddenWaitingCount > 0 ? (
          <span className="workspace-sidebar__filter-attention" aria-hidden="true" />
        ) : null}
      </button>
      <Popover
        open={isOpen}
        anchorRef={triggerRef}
        onDismiss={() => setIsOpen(false)}
        align="end"
        id={panelId}
        role="group"
        aria-label={t('sidebar.filters')}
        className={`workspace-sidebar__filters${isMobile ? ' workspace-sidebar__filters--mobile' : ''}`}
        data-testid="workspace-sidebar-filters"
      >
        <div className="workspace-sidebar__filters-heading">
          <strong>{t('sidebar.filters')}</strong>
          <button
            type="button"
            disabled={!hasFilter}
            onClick={() => onChange(DEFAULT_SIDEBAR_VIEW_FILTERS)}
          >
            {t('sidebar.resetFilters')}
          </button>
        </div>
        <label>
          <span>{t('sidebar.filterStatus')}</span>
          <CoveSelect
            value={filters.status}
            id={`${panelId}-status`}
            size="compact"
            ariaLabel={t('sidebar.filterStatus')}
            testId="sidebar-filter-status"
            menuClassName="workspace-sidebar__filter-options"
            options={['all', 'working', 'waiting', 'standby'].map(value => ({
              value,
              label: value === 'all' ? t('sidebar.all') : t(`sidebar.status.${value}`),
            }))}
            onChange={value => update('status', value)}
          />
        </label>
        <label>
          <span>{t('sidebar.filterProvider')}</span>
          <CoveSelect
            value={filters.provider}
            size="compact"
            ariaLabel={t('sidebar.filterProvider')}
            testId="sidebar-filter-provider"
            menuClassName="workspace-sidebar__filter-options"
            options={[
              { value: 'all', label: t('sidebar.all') },
              ...AGENT_PROVIDERS.map(value => ({ value, label: AGENT_PROVIDER_LABEL[value] })),
            ]}
            onChange={value => update('provider', value)}
          />
        </label>
        <label>
          <span>{t('sidebar.filterVisibility')}</span>
          <CoveSelect
            value={filters.visibility}
            size="compact"
            ariaLabel={t('sidebar.filterVisibility')}
            testId="sidebar-filter-visibility"
            menuClassName="workspace-sidebar__filter-options"
            options={[
              { value: 'visible', label: t('sidebar.visible') },
              { value: 'all', label: t('sidebar.allVisibility') },
              { value: 'hidden', label: t('sidebar.hidden') },
            ]}
            onChange={value => update('visibility', value)}
          />
        </label>
      </Popover>
    </>
  )
}
