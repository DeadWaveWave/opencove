import { runLegacy } from './run.mjs'
export async function legacyAdapter(argv: string[]): Promise<number> {
  await runLegacy(argv)
  return Number(process.exitCode ?? 0)
}
