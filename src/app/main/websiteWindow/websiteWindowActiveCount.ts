import type { WebsiteWindowRuntime } from './websiteWindowRuntime'

export function countActiveWebsiteWindowRuntimes(runtimes: Iterable<WebsiteWindowRuntime>): number {
  let count = 0
  for (const runtime of runtimes) {
    if (runtime.lifecycle === 'active') {
      count += 1
    }
  }
  return count
}
