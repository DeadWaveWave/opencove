declare module 'font-list' {
  export function getFonts(options?: { disableQuoting?: boolean }): Promise<string[]>
}
