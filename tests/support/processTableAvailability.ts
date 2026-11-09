/** Only an explicit EPERM from ps may suppress the production ps adapter tests. */
export async function canReadProcessTable(read: () => Promise<unknown>): Promise<boolean> {
  try {
    await read()
    return true
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'EPERM') {
      return false
    }
    throw error
  }
}
