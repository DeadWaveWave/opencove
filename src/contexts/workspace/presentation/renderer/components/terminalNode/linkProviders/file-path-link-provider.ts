import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import {
  detectLinks,
  detectLinkSuffixes,
  getCurrentOS,
  getLinkSuffix,
  type ILinkSuffix,
  type OperatingSystem,
} from './link-parsing'
import { detectFallbackLinks } from './fallback-matchers'
import { detectTerminalUrls } from './url-link-provider'
import {
  isTerminalLinkSnapshotCurrent,
  readTerminalLinkSnapshot,
  terminalLinkRange,
  type TerminalDetectedLink,
  type TerminalLinkProviderOptions,
  type TerminalLinkTarget,
} from './terminal-link-snapshot'

type FileTarget = Extract<TerminalLinkTarget, { kind: 'file' }>

interface FileMatch {
  startIndex: number
  endIndex: number
  target: FileTarget
}

export interface FilePathLinkProviderOptions extends TerminalLinkProviderOptions {
  getSourceOS?: () => OperatingSystem
}

const BARE_PROJECT_FILES = /^(?:Makefile|Dockerfile|README|LICENSE|CHANGELOG|Gemfile|Procfile)$/

function looksLikeFilePath(path: string): boolean {
  if (/^(?!file:)[a-z][\w+.-]*:\/\//i.test(path) || /^v?\d+(?:\.\d+)+$/.test(path)) {
    return false
  }
  if (/^@[^/]+\/[^/]+@\d/.test(path) || !path.trim()) {
    return false
  }
  return /[/\\]/.test(path) || /\.[\p{L}\p{N}_+-]+$/u.test(path) || BARE_PROJECT_FILES.test(path)
}

function fileTarget(path: string, suffix?: ILinkSuffix | null): FileTarget {
  return {
    kind: 'file',
    path,
    line: suffix?.row,
    column: suffix?.col,
    lineEnd: suffix?.rowEnd,
    columnEnd: suffix?.colEnd,
  }
}

function rangesOverlap(
  left: FileMatch,
  right: Pick<FileMatch, 'startIndex' | 'endIndex'>,
): boolean {
  return left.startIndex < right.endIndex && right.startIndex < left.endIndex
}

export function detectTerminalFilePaths(text: string, os: OperatingSystem): FileMatch[] {
  if (!/[/\\\d]/.test(text)) {
    return []
  }
  const matches: FileMatch[] = []
  const urls = [
    ...detectTerminalUrls(text),
    ...Array.from(text.matchAll(/\b(?!file:)[a-z][\w+.-]*:\/\/[^\s<>"']+/gi), match => ({
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    })),
  ]
  const add = (candidate: FileMatch): void => {
    if (
      !looksLikeFilePath(candidate.target.path) ||
      [
        candidate.target.line,
        candidate.target.column,
        candidate.target.lineEnd,
        candidate.target.columnEnd,
      ].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 1)) ||
      urls.some(url => rangesOverlap(candidate, url)) ||
      matches.some(existing => rangesOverlap(candidate, existing))
    ) {
      return
    }
    matches.push(candidate)
  }

  // Tool formats own their complete ranges before generic matches can claim fragments.
  for (const fallback of detectFallbackLinks(text)) {
    add({
      startIndex: fallback.index,
      endIndex: fallback.index + fallback.link.length,
      target: { kind: 'file', path: fallback.path, line: fallback.line, column: fallback.col },
    })
  }

  for (const match of text.matchAll(/(["'])([^"'\r\n]+)\1/g)) {
    const value = match[2]!
    const insideSuffix = getLinkSuffix(value)
    const closingQuote = match.index + match[0].length - 1
    const outsideSuffix = detectLinkSuffixes(text.slice(closingQuote))[0]
    const suffix =
      insideSuffix ?? (outsideSuffix && outsideSuffix.suffix.index <= 1 ? outsideSuffix : undefined)
    add({
      startIndex: match.index,
      endIndex:
        !insideSuffix && suffix
          ? closingQuote + suffix.suffix.index + suffix.suffix.text.length
          : match.index + match[0].length,
      target: fileTarget(insideSuffix ? value.slice(0, insideSuffix.suffix.index) : value, suffix),
    })
  }

  for (const parsed of detectLinks(text, os)) {
    const path = parsed.suffix ? parsed.path.text : parsed.path.text.replace(/[.,;:!?)]+$/, '')
    const startIndex = parsed.prefix?.index ?? parsed.path.index
    const endIndex = parsed.suffix
      ? parsed.suffix.suffix.index + parsed.suffix.suffix.text.length
      : parsed.path.index + path.length
    add({ startIndex, endIndex, target: fileTarget(path, parsed.suffix) })
  }
  return matches.sort((left, right) => left.startIndex - right.startIndex)
}

export class FilePathLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly onOpen: (
      event: MouseEvent,
      path: string,
      line?: number,
      column?: number,
      lineEnd?: number,
      columnEnd?: number,
    ) => void,
    private readonly options: FilePathLinkProviderOptions = {},
  ) {}

  getLinks(bufferLineNumber: number): TerminalDetectedLink[] {
    const snapshot = readTerminalLinkSnapshot(this.terminal, bufferLineNumber)
    if (!snapshot) {
      return []
    }
    const os = this.options.getSourceOS?.() ?? getCurrentOS()
    return detectTerminalFilePaths(snapshot.text, os).flatMap(match => {
      const range = terminalLinkRange(snapshot, match.startIndex, match.endIndex)
      if (!range || bufferLineNumber < range.start.y || bufferLineNumber > range.end.y) {
        return []
      }
      return [
        {
          text: snapshot.text.slice(match.startIndex, match.endIndex),
          range,
          target: match.target,
          snapshot,
        },
      ]
    })
  }

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const links = this.getLinks(bufferLineNumber).map(
      (link): ILink => ({
        text: link.text,
        range: link.range,
        activate: event => {
          if (!isTerminalLinkSnapshotCurrent(this.terminal, link.snapshot)) {
            return
          }
          if (this.options.onActivate) {
            this.options.onActivate(event, link)
          } else if ((event.metaKey || event.ctrlKey) && link.target.kind === 'file') {
            event.preventDefault()
            const { path, line, column, lineEnd, columnEnd } = link.target
            this.onOpen(event, path, line, column, lineEnd, columnEnd)
          }
        },
      }),
    )
    callback(links.length > 0 ? links : undefined)
  }
}
