export function createArchitectureCacheOrder() {
  const generations = new Map<string, number>()

  return {
    capture: (key: readonly unknown[]) => {
      const id = cacheKey(key)
      return { id, generation: generations.get(id) ?? 0 }
    },
    mark: (key: readonly unknown[]) => {
      const id = cacheKey(key)
      generations.set(id, (generations.get(id) ?? 0) + 1)
    },
    current: (token: { readonly id: string; readonly generation: number }) =>
      (generations.get(token.id) ?? 0) === token.generation,
  }
}

export async function guardedArchitectureCacheResponse<T>(input: {
  readonly cacheOrder: ReturnType<typeof createArchitectureCacheOrder>
  readonly key: readonly unknown[]
  readonly observe: () => Promise<T>
  readonly current: () => T | undefined
}) {
  const token = input.cacheOrder.capture(input.key)
  const observed = await input.observe()
  if (input.cacheOrder.current(token)) return observed
  const current = input.current()
  return current === undefined ? observed : current
}

function cacheKey(key: readonly unknown[]) {
  return JSON.stringify(key)
}
