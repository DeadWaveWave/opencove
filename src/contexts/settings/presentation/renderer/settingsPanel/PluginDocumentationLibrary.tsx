import { useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { PluginReadme } from '@contexts/plugins/presentation/renderer/PluginReadme'
import {
  pluginHandbook,
  resolveHandbookLink,
} from '@contexts/plugins/presentation/renderer/pluginHandbook'

export function PluginDocumentationLibrary({ onBack }: { onBack: () => void }): JSX.Element {
  const { t, i18n } = useTranslation()
  const articles = useMemo(() => pluginHandbook(i18n.language), [i18n.language])
  const [route, setRoute] = useState<string | null>(null)
  const [id, anchor] = route?.split('#') ?? []
  const article = articles.find(item => item.id === id)
  const root = useRef<HTMLDivElement>(null)
  const returnPoint = useRef<{ id: string; scroll: number } | null>(null)
  useLayoutEffect(() => {
    const scroller = root.current?.closest<HTMLElement>('.settings-panel__content')
    if (article) {
      if (scroller) {
        scroller.scrollTop = 0
      }
      root.current
        ?.querySelector<HTMLElement>('[data-library-heading], .plugin-readme h1')
        ?.focus({ preventScroll: true })
    } else if (returnPoint.current) {
      if (scroller) {
        scroller.scrollTop = returnPoint.current.scroll
      }
      root.current
        ?.querySelector<HTMLElement>(`[data-testid="plugin-library-${returnPoint.current.id}"]`)
        ?.focus({ preventScroll: true })
      returnPoint.current = null
    } else {
      root.current
        ?.querySelector<HTMLElement>('[data-library-heading], .plugin-readme h1')
        ?.focus({ preventScroll: true })
    }
  }, [article])
  return (
    <div className="settings-plugin-library" data-testid="plugin-documentation-library" ref={root}>
      <button
        type="button"
        className="settings-plugin-detail__back"
        onClick={article ? () => setRoute(null) : onBack}
        data-testid="plugin-library-back"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {t(`settingsPanel.plugins.${article ? 'library.back' : 'back'}`)}
      </button>
      {article ? (
        <>
          <header className="settings-plugin-library__article-header">
            <span>{t(`settingsPanel.plugins.library.${article.category}`)}</span>
          </header>
          <PluginReadme
            focusTitle
            markdown={article.markdown}
            assets={article.assets}
            anchor={anchor}
            resolveDocumentLink={href => resolveHandbookLink(href, article, articles)}
            onOpenDocument={setRoute}
          />
        </>
      ) : (
        <>
          <header className="settings-plugin-library__intro">
            <BookOpen size={24} aria-hidden="true" />
            <h3 tabIndex={-1} data-library-heading>
              {t('settingsPanel.plugins.library.title')}
            </h3>
            <p>{t('settingsPanel.plugins.library.description')}</p>
          </header>
          {(['start', 'tutorial', 'reference'] as const).map(category => (
            <section
              className="settings-plugin-library__group"
              key={category}
              aria-labelledby={`plugin-library-group-${category}`}
            >
              <h4 id={`plugin-library-group-${category}`}>
                {t(`settingsPanel.plugins.library.${category}`)}
              </h4>
              <div className="settings-plugin-library__grid">
                {articles
                  .filter(item => item.category === category)
                  .map(item => (
                    <button
                      type="button"
                      key={item.id}
                      className="settings-plugin-library__card"
                      data-testid={`plugin-library-${item.id}`}
                      onClick={() => {
                        returnPoint.current = {
                          id: item.id,
                          scroll:
                            root.current?.closest<HTMLElement>('.settings-panel__content')
                              ?.scrollTop ?? 0,
                        }
                        setRoute(item.id)
                      }}
                    >
                      <span>
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
