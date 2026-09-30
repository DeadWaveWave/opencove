import { describe, expect, it } from 'vitest'
import { projectPluginWindowTitles } from '../../../../src/contexts/workspace/application/nodeControl/pluginWindowTitles'
import type { PluginLiveView } from '../../../../src/contexts/plugins/domain/pluginRuntimeTypes'

const window = {
  nodeId: 'node',
  projectId: 'project',
  spaceId: null,
  title: 'Saved title',
  titlePinnedByUser: false,
}
const view = (viewId: string, contentTitle?: string): PluginLiveView => ({
  nodeId: 'node',
  viewId,
  ready: false,
  ...(contentTitle === undefined ? {} : { contentTitle }),
})

describe('plugin window title projection', () => {
  it('reports content titles independently of command readiness without mutating saved metadata', () => {
    const views = [view('one', 'Reading')]
    const [result] = projectPluginWindowTitles([window], views)
    expect(result).toMatchObject({
      title: 'Reading',
      savedTitle: 'Saved title',
      views: [{ title: 'Reading', ready: false }],
    })
    expect(window.title).toBe('Saved title')
    expect(views[0]).not.toHaveProperty('title')
  })

  it('uses a shared title only when every view agrees, regardless of view order', () => {
    expect(
      projectPluginWindowTitles([window], [view('one', 'Reading'), view('two', 'Reading')])[0]
        .title,
    ).toBe('Reading')
    const different = [view('one', 'Reading'), view('two', 'Writing')]
    for (const views of [
      different,
      [...different].reverse(),
      [view('one', 'Reading'), view('two')],
    ]) {
      const [result] = projectPluginWindowTitles([window], views)
      expect(result.title).toBe('Saved title')
      expect(result.views.map(item => item.title)).toEqual(
        views.map(item => item.contentTitle ?? 'Saved title'),
      )
    }
  })

  it('always preserves a user-pinned title while exposing the distinct reported content titles', () => {
    const [result] = projectPluginWindowTitles(
      [{ ...window, titlePinnedByUser: true }],
      [view('one', 'Reading'), view('two', 'Writing')],
    )
    expect(result.title).toBe('Saved title')
    expect(result.views.map(item => item.title)).toEqual(['Saved title', 'Saved title'])
    expect(result.views.map(item => item.contentTitle)).toEqual(['Reading', 'Writing'])
  })

  it('falls back to saved metadata after leases close and ignores views belonging to another node', () => {
    const [result] = projectPluginWindowTitles(
      [window],
      [{ ...view('other', 'Unrelated'), nodeId: 'other' }],
    )
    expect(result).toMatchObject({ title: 'Saved title', savedTitle: 'Saved title', views: [] })
  })
})
