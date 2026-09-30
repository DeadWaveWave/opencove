import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginReadme, resolvePluginMarkdownUrl } from './PluginReadme'

afterEach(cleanup)

describe('plugin documentation', () => {
  it('renders authored Markdown, tables, code, bundled images and external links', () => {
    const detail = {
      readme:
        '# Your tool\n\n| Feature | Purpose |\n| --- | --- |\n| Window | Working area |\n\n`opencove plugin guide`\n\n![Example](./example.svg)\n\n[API](https://example.com/api)',
      assets: { './example.svg': '/example.svg' },
    }
    render(<PluginReadme markdown={detail.readme} assets={detail.assets} />)
    expect(screen.getByRole('heading', { name: 'Your tool' })).toBeVisible()
    expect(screen.getByRole('table')).toHaveTextContent('Working area')
    expect(screen.getByText('opencove plugin guide').tagName).toBe('CODE')
    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('src', detail.assets['./example.svg'])
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.getByRole('link', { name: 'API' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'API' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens only registered internal documents through the host reader', () => {
    const onOpenDocument = vi.fn()
    render(
      <PluginReadme
        markdown={'[Guide](./guide.md)\n\n[Private](../secret.md)'}
        resolveDocumentLink={href => (href === './guide.md' ? 'guide' : null)}
        onOpenDocument={onOpenDocument}
      />,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Guide' }))
    expect(onOpenDocument).toHaveBeenCalledWith('guide')
    expect(screen.queryByRole('link', { name: 'Private' })).toBeNull()
  })

  it('supports HTTPS images but does not execute document HTML or navigate unsafe links', () => {
    const { container } = render(
      <PluginReadme
        markdown={[
          '![Diagram](https://example.com/diagram.png)',
          '[Unsafe](javascript:alert%281%29)',
          '![Local](file:///etc/passwd)',
          '![Unknown](./missing.png)',
          '<script>alert(1)</script>',
          '<iframe src="https://example.com" />',
        ].join('\n\n')}
      />,
    )
    expect(screen.getByRole('img', { name: 'Diagram' })).toHaveAttribute(
      'src',
      'https://example.com/diagram.png',
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container.querySelector('script, iframe')).toBeNull()
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByText('Local')).toBeVisible()
    expect(screen.getByText('Unknown')).toBeVisible()
  })

  it('scrolls local heading links without changing the application route', () => {
    render(<PluginReadme markdown={'[Jump](#hello-world)\n\n## Hello world'} />)
    const heading = screen.getByRole('heading', { name: 'Hello world' })
    const scroll = vi.fn()
    heading.scrollIntoView = scroll
    const href = window.location.href
    fireEvent.click(screen.getByRole('link', { name: 'Jump' }))
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(window.location.href).toBe(href)
  })

  it.each([
    'javascript:alert(1)',
    'file:///private/secret',
    '//example.com/image.png',
    'data:text/html,x',
    '../private.png',
    'http://example.com/insecure.png',
  ])('does not resolve unapproved image URL %s', value => {
    expect(resolvePluginMarkdownUrl(value, 'src', {})).toBe('')
  })
})
