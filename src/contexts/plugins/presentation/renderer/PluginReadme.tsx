import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type JSX,
  type RefObject,
} from 'react'
import Markdown, { type Components } from 'react-markdown'
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

const ReadmeContext = createContext<{
  root: RefObject<HTMLElement | null>
  focusTitle: boolean
  resolveDocumentLink?: (href: string) => string | null
  onOpenDocument?: (id: string) => void
} | null>(null)

// Component identities must survive metadata/status updates: replacing them would
// remount images and discard focus while the user is reading or following a link.
const readmeComponents: Components = {
  h1: function ReadmeHeading({ children }) {
    const context = useContext(ReadmeContext)
    return <h1 tabIndex={context?.focusTitle ? -1 : undefined}>{children}</h1>
  },
  a: function ReadmeLink({ href, children, title }) {
    const context = useContext(ReadmeContext)
    if (!href) {
      return <span>{children}</span>
    }
    const documentId = context?.resolveDocumentLink?.(href)
    if (documentId && context?.onOpenDocument) {
      return (
        <a
          href={href}
          title={title}
          onClick={event => {
            event.preventDefault()
            context.onOpenDocument?.(documentId)
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
              context?.root.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [],
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
}

/** Render documentation as content. Image paths and internal document links are explicitly registered by the caller. */
export function PluginReadme({
  markdown,
  assets = {},
  resolveDocumentLink,
  resolveUrl,
  onOpenDocument,
  anchor,
  focusTitle = false,
}: {
  markdown: string
  assets?: Readonly<Record<string, string>>
  resolveUrl?: (url: string, kind: string) => string
  resolveDocumentLink?: (href: string) => string | null
  onOpenDocument?: (id: string) => void
  anchor?: string
  focusTitle?: boolean
}): JSX.Element {
  const root = useRef<HTMLElement>(null)
  const context = useMemo(
    () => ({ root, focusTitle, resolveDocumentLink, onOpenDocument }),
    [focusTitle, resolveDocumentLink, onOpenDocument],
  )
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
      <ReadmeContext.Provider value={context}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          urlTransform={(url, key) =>
            key === 'href' && resolveDocumentLink?.(url)
              ? url
              : resolvePluginMarkdownUrl(resolveUrl?.(url, key) ?? url, key, assets)
          }
          components={readmeComponents}
        >
          {markdown}
        </Markdown>
      </ReadmeContext.Provider>
    </article>
  )
}
