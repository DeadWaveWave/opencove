import { useEffect, useRef, type JSX } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function resolvePluginMarkdownUrl(
  value: string,
  kind: string,
  assets: Readonly<Record<string, string>>,
): string {
  if (kind === 'src') {
    const bundled = Object.hasOwn(assets, value) ? assets[value] : undefined
    if (bundled) {
      return bundled
    }
    return /^https:\/\//i.test(value) ? value : ''
  }
  if (value.startsWith('#') || /^https?:\/\//i.test(value)) {
    return value
  }
  return ''
}

function headingAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/** Render documentation as content. Image paths and internal document links are explicitly registered by the caller. */
export function PluginReadme({
  markdown,
  assets = {},
  resolveDocumentLink,
  onOpenDocument,
  anchor,
  focusTitle = false,
}: {
  markdown: string
  assets?: Readonly<Record<string, string>>
  resolveDocumentLink?: (href: string) => string | null
  onOpenDocument?: (id: string) => void
  anchor?: string
  focusTitle?: boolean
}): JSX.Element {
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (anchor) {
      const heading = Array.from(root.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? []).find(
        element => headingAnchor(element.textContent ?? '') === anchor,
      )
      heading?.scrollIntoView({ block: 'start' })
    }
  }, [markdown, anchor])
  return (
    <article className="plugin-readme" data-testid="plugin-readme" ref={root}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) =>
          key === 'href' && resolveDocumentLink?.(url)
            ? url
            : resolvePluginMarkdownUrl(url, key, assets)
        }
        components={{
          h1: ({ children }) => <h1 tabIndex={focusTitle ? -1 : undefined}>{children}</h1>,
          a: ({ href, children, title }) => {
            if (!href) {
              return <span>{children}</span>
            }
            const documentId = resolveDocumentLink?.(href)
            if (documentId && onOpenDocument) {
              return (
                <a
                  href={href}
                  title={title}
                  onClick={event => {
                    event.preventDefault()
                    onOpenDocument(documentId)
                  }}
                >
                  {children}
                </a>
              )
            }
            if (href.startsWith('#')) {
              return (
                <a
                  href={href}
                  title={title}
                  onClick={event => {
                    event.preventDefault()
                    let localAnchor = href.slice(1)
                    try {
                      localAnchor = decodeURIComponent(localAnchor)
                    } catch {
                      /* Keep literal anchors. */
                    }
                    const heading = Array.from(
                      root.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [],
                    ).find(element => headingAnchor(element.textContent ?? '') === localAnchor)
                    heading?.scrollIntoView({ block: 'nearest' })
                  }}
                >
                  {children}
                </a>
              )
            }
            return (
              <a href={href} title={title} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
          img: ({ src, alt, title }) =>
            src ? (
              <img
                src={src}
                alt={alt ?? ''}
                title={title}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="plugin-readme__image-fallback">{alt}</span>
            ),
          table: ({ children }) => (
            <div className="plugin-readme__table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {markdown}
      </Markdown>
    </article>
  )
}
