import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import {
  isTerminalLinkSnapshotCurrent,
  readTerminalLinkSnapshot,
  terminalLinkRange,
  type TerminalDetectedLink,
  type TerminalLinkProviderOptions,
} from './terminal-link-snapshot'

export interface TerminalUrlMatch {
  text: string
  startIndex: number
  endIndex: number
}

function trimUrlWrapper(value: string): string {
  const openings: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const counts: Record<string, number> = { '(': 0, '[': 0, '{': 0 }
  let end = value.length
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (char in counts) {
      counts[char] = counts[char]! + 1
    }
    const opening = openings[char]
    if (opening) {
      if (counts[opening] === 0) {
        end = index
        break
      }
      counts[opening] = counts[opening]! - 1
    }
  }
  const text = value.slice(0, end)
  // Query/fragment punctuation can be significant; only trim prose after a plain URL.
  return /[?#]/.test(text) ? text : text.replace(/[.,;:!]+$/, '')
}

export function detectTerminalUrls(text: string): TerminalUrlMatch[] {
  const links: TerminalUrlMatch[] = []
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'\p{Cc}]+/giu)) {
    const uri = trimUrlWrapper(match[0])
    try {
      const parsed = new URL(uri)
      if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol)) {
        continue
      }
    } catch {
      continue
    }
    links.push({ text: uri, startIndex: match.index, endIndex: match.index + uri.length })
  }
  return links
}

export class UrlLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly onOpen: (event: MouseEvent, uri: string) => void,
    private readonly options: TerminalLinkProviderOptions = {},
  ) {}

  getLinks(bufferLineNumber: number): TerminalDetectedLink[] {
    const snapshot = readTerminalLinkSnapshot(this.terminal, bufferLineNumber)
    if (!snapshot) {
      return []
    }
    return detectTerminalUrls(snapshot.text).flatMap(match => {
      const range = terminalLinkRange(snapshot, match.startIndex, match.endIndex)
      if (!range || bufferLineNumber < range.start.y || bufferLineNumber > range.end.y) {
        return []
      }
      return [{ text: match.text, range, target: { kind: 'url', uri: match.text }, snapshot }]
    })
  }

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const links = this.getLinks(bufferLineNumber).map(
      (link): ILink => ({
        range: link.range,
        text: link.text,
        activate: event => {
          if (!isTerminalLinkSnapshotCurrent(this.terminal, link.snapshot)) {
            return
          }
          if (this.options.onActivate) {
            this.options.onActivate(event, link)
          } else if ((event.metaKey || event.ctrlKey) && link.target.kind === 'url') {
            event.preventDefault()
            this.onOpen(event, link.target.uri)
          }
        },
      }),
    )
    callback(links.length > 0 ? links : undefined)
  }
}
