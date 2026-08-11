import { describe, expect, test } from "bun:test"
import { createArchitectureCacheOrder, guardedArchitectureCacheResponse } from "./cache-order"
import type { ArchitectureLiveInstance, ArchitectureSnapshot } from "./contract"

describe("architecture cache order", () => {
  test("keeps the current cache when a late refetch resolves after save or reload", async () => {
    const cacheOrder = createArchitectureCacheOrder()
    const key = ["architecture-resource-instance", "server", "/repo", "design"] as const
    const current = live("current")
    const pending = deferred<ArchitectureLiveInstance>()

    const response = guardedArchitectureCacheResponse<ArchitectureLiveInstance>({
      cacheOrder,
      key,
      current: () => current,
      observe: () => pending.promise,
    })

    cacheOrder.mark(key)
    pending.resolve(live("stale"))

    await expect(response).resolves.toBe(current)
  })

  test("keeps a cleared instance when a late saved response arrives after reload", async () => {
    const cacheOrder = createArchitectureCacheOrder()
    const key = ["architecture-resource-instance", "server", "/repo", "design"] as const
    const pending = deferred<ArchitectureLiveInstance | null>()

    const response = guardedArchitectureCacheResponse<ArchitectureLiveInstance | null>({
      cacheOrder,
      key,
      current: () => null,
      observe: () => pending.promise,
    })

    cacheOrder.mark(key)
    pending.resolve(live("late"))

    await expect(response).resolves.toBeNull()
  })
})

function live(text: string): ArchitectureLiveInstance {
  return {
    source: "live",
    snapshot: snapshot(text),
  }
}

function snapshot(text: string): ArchitectureSnapshot {
  return {
    digest: text,
    storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
    resource: {
      version: 2,
      revision: 1,
      id: "design",
      name: text,
      nodes: [],
      edges: [],
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
