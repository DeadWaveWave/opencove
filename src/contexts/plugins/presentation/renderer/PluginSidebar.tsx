import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { isPluginContributionEnabled } from '@contexts/settings/domain/pluginSettings'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginSidebarDeclaration, PluginSidebarItem } from '../../domain/pluginSidebar'
import type { PluginManifest } from '../../domain/pluginTypes'
import { PluginIcon } from './PluginIcon'
import { getPluginManifest, usePluginRegistry } from './usePluginRegistry'
import { pluginErrorMessage } from './pluginErrorMessage'

function SidebarItems({
  items,
  busy,
  run,
}: {
  items: PluginSidebarItem[]
  busy: boolean
  run: (item: PluginSidebarItem) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  return (
    <ul className="plugin-sidebar__items">
      {items.map(item => (
        <li key={item.id}>
          <div className="plugin-sidebar__item">
            {item.children?.length ? (
              <button
                type="button"
                className="plugin-sidebar__disclosure"
                aria-label={item.label}
                aria-expanded={expanded.has(item.id)}
                onClick={() =>
                  setExpanded(previous => {
                    const next = new Set(previous)
                    if (next.has(item.id)) {
                      next.delete(item.id)
                    } else {
                      next.add(item.id)
                    }
                    return next
                  })
                }
              >
                {expanded.has(item.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : (
              <span className="plugin-sidebar__leaf" aria-hidden="true" />
            )}
            {item.command ? (
              <button
                type="button"
                className="plugin-sidebar__label"
                disabled={busy}
                title={item.description ?? item.label}
                onClick={() => run(item)}
              >
                {item.label}
              </button>
            ) : (
              <span className="plugin-sidebar__label" title={item.description ?? item.label}>
                {item.label}
              </span>
            )}
            {item.description ? (
              <span className="plugin-sidebar__description" title={item.description}>
                {item.description}
              </span>
            ) : null}
          </div>
          {item.children?.length && expanded.has(item.id) ? (
            <SidebarItems items={item.children} busy={busy} run={run} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function SidebarSection({
  plugin,
  section,
  projectId,
}: {
  plugin: PluginManifest
  section: PluginSidebarDeclaration
  projectId: string
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<PluginSidebarItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const pending = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Invalidate the latest request counter, not a captured DOM element.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
    }
  }, [])
  const current = () => {
    const value = getPluginManifest(plugin.id)
    return (
      mounted.current &&
      value?.enabled !== false &&
      value?.status === 'ready' &&
      value.revision === plugin.revision &&
      value.runtimeGeneration === plugin.runtimeGeneration
    )
  }
  const load = async () => {
    if (pending.current || !current()) {
      return
    }
    const id = ++generation.current
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await window.opencoveApi.controlSurface.invoke<{ items: PluginSidebarItem[] }>(
        {
          kind: 'query',
          id: 'plugin.sidebar.items',
          payload: {
            pluginId: plugin.id,
            sectionId: section.id,
            projectId,
            expectedRevision: plugin.revision,
            expectedRuntimeGeneration: plugin.runtimeGeneration,
          },
        },
      )
      if (current() && id === generation.current) {
        setItems(result.items)
        setLoaded(true)
      }
    } catch (cause) {
      if (current() && id === generation.current) {
        setError(pluginErrorMessage(cause))
      }
    } finally {
      pending.current = false
      if (mounted.current && id === generation.current) {
        setBusy(false)
      }
    }
  }
  const run = async (item: PluginSidebarItem) => {
    if (!item.command || pending.current || !current()) {
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'plugin.command.run',
        payload: {
          pluginId: plugin.id,
          commandId: item.command.id,
          params: item.command.params ?? null,
          context: { surface: 'sidebar', projectId },
          expectedRevision: plugin.revision,
          expectedRuntimeGeneration: plugin.runtimeGeneration,
        },
      })
    } catch (cause) {
      if (current()) {
        setError(pluginErrorMessage(cause))
      }
    } finally {
      pending.current = false
      if (mounted.current) {
        setBusy(false)
      }
    }
  }
  return (
    <section
      className="plugin-sidebar__section"
      data-testid={`plugin-sidebar-${plugin.id}-${section.id}`}
    >
      <header>
        <button
          type="button"
          className="plugin-sidebar__heading"
          aria-expanded={expanded}
          title={`${section.title} · ${plugin.displayName}`}
          onClick={() => {
            setExpanded(!expanded)
            if (!expanded && !loaded) {
              void load()
            }
          }}
        >
          <PluginIcon pluginId={plugin.id} size={14} />
          <span>{section.title}</span>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {expanded ? (
          <button
            type="button"
            className="plugin-sidebar__refresh"
            disabled={busy}
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            onClick={() => void load()}
          >
            <RefreshCw size={12} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {expanded ? (
        <div aria-busy={busy}>
          {error ? (
            <p className="plugin-sidebar__error" role="alert">
              {error}
            </p>
          ) : null}
          {busy && !loaded ? <p role="status">{t('common.loading')}</p> : null}
          {loaded && !items.length ? <p>{t('pluginHostExtensions.emptySidebar')}</p> : null}
          <SidebarItems items={items} busy={busy} run={item => void run(item)} />
        </div>
      ) : null}
    </section>
  )
}

export function PluginSidebar({ projectId }: { projectId: string }) {
  const { plugins } = usePluginRegistry()
  const settings = useAppStore(state => state.agentSettings)
  return (
    <>
      {plugins
        .filter(
          plugin =>
            plugin.enabled !== false &&
            plugin.status === 'ready' &&
            isPluginContributionEnabled(settings, plugin.id, 'sidebar'),
        )
        .flatMap(plugin =>
          (plugin.sidebar ?? []).map(section => (
            <SidebarSection
              key={`${projectId}:${plugin.id}:${plugin.revision}:${plugin.runtimeGeneration}:${section.id}`}
              plugin={plugin}
              section={section}
              projectId={projectId}
            />
          )),
        )}
    </>
  )
}
