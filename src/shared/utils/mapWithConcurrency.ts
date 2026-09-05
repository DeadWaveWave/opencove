/** Preserves input order while limiting independent asynchronous work. */
export async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length)
  let nextIndex = 0
  const runWorker = async (): Promise<void> => {
    const index = nextIndex++
    if (index >= items.length) {
      return
    }
    results[index] = await mapper(items[index]!)
    await runWorker()
  }
  await Promise.all(
    Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(concurrency))) }, runWorker),
  )
  return results
}
