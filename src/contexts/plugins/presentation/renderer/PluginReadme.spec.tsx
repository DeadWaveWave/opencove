import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginReadme, resolvePluginMarkdownUrl } from './PluginReadme'
import { getPluginDetail } from './pluginDetails'

afterEach(cleanup)

describe('plugin documentation', () => {
  it('renders authored Markdown, tables, code, bundled images and external links', () => {
    const detail = getPluginDetail('git-board', 'en')!
    render(<PluginReadme markdown={detail.readme} assets={detail.assets} />)
    expect(screen.getByRole('heading', { name: 'Your repository, beside your work' })).toBeVisible()
    expect(screen.getByRole('table')).toHaveTextContent('Working tree')
    expect(screen.getByText('opencove plugin guide').tagName).toBe('CODE')
    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('src', detail.assets['./overview.svg'])
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(screen.getByRole('link', { name: 'Git history' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Git history' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    )
  })

  it('resolves localized package docs without pretending unknown plugins have documentation', () => {
    const detail = getPluginDetail('git-board', 'zh-CN')!
    render(<PluginReadme markdown={detail.readme} assets={detail.assets} />)
    expect(screen.getByRole('heading', { name: '把仓库放在工作旁边' })).toBeVisible()
    expect(screen.getByRole('img')).toHaveAttribute('alt', '纵向提交历史与画布窗口的示意图')
    expect(getPluginDetail('missing', 'en')).toBeNull()
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
