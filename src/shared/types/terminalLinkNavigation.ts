export interface TerminalFileLinkOpenRequest {
  uri: string
  mountId: string | null
  kind?: 'file' | 'directory'
  line?: number
  column?: number
  lineEnd?: number
  columnEnd?: number
}
