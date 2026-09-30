import type { PluginLiveView } from '../../../plugins/domain/pluginRuntimeTypes'
import type { PluginWindowSummary } from './pluginWindows'

/** Client content titles are observations; they never replace saved or user-pinned metadata. */
export function projectPluginWindowTitles(windows: PluginWindowSummary[], views: PluginLiveView[]) {
  return windows.map(window => {
    const currentViews = views
      .filter(view => view.nodeId === window.nodeId)
      .map(view => ({
        ...view,
        title: window.titlePinnedByUser ? window.title : (view.contentTitle ?? window.title),
      }))
    const titles = new Set(currentViews.map(view => view.title))
    return {
      ...window,
      title: titles.size === 1 ? currentViews[0].title : window.title,
      savedTitle: window.title,
      views: currentViews,
    }
  })
}
