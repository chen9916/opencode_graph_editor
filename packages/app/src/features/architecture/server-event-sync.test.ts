import { describe, expect, test } from "bun:test"
import type { ArchitectureListResourcesOutput } from "@opencode-ai/client/promise"
import { createArchitectureCacheOrder } from "./cache-order"
import type { ArchitectureLiveInstance, ArchitectureLiveInstanceCache, ArchitectureRuntimeDebugEvent, ArchitectureSnapshot } from "./contract"
import { syncArchitectureServerEvent } from "./server-event-sync"

describe("architecture server event sync", () => {
  test("adopts a metadata-only live instance event through an authoritative refetch", async () => {
    let instance: ArchitectureLiveInstanceCache = live("current")
    const calls = recorder()

    await syncArchitectureServerEvent({
      ...baseInput(calls),
      event: {
        type: "architecture.resource.instance.updated",
        data: { resourceID: "design", revision: 1, digest: "external", baseRevision: 0, baseDigest: "saved" },
      },
      currentInstance: () => instance,
      loadInstance: async () => live("external"),
      setInstance: (_resourceID, next) => {
        instance = next(instance) ?? instance
      },
    })

    expect(instance?.snapshot.digest).toBe("external")
    expect(calls.debug.map((event) => `${event.type}:${event.status}`)).toEqual([
      "server-event:received",
      "sync:started",
      "sync:succeeded",
    ])
    expect(calls.debug.at(-1)?.details).toContainEqual({ key: "reason", value: "live-response" })
  })

  test("records stale instance events without mutating cache", async () => {
    let updated = false
    const calls = recorder()

    await syncArchitectureServerEvent({
      ...baseInput(calls),
      event: {
        type: "architecture.resource.instance.updated",
        data: { resourceID: "design", revision: 1, digest: "old-live", baseRevision: 1, baseDigest: "old" },
      },
      snapshot: () => snapshot(2, "new-saved"),
      setInstance: () => {
        updated = true
      },
    })

    expect(updated).toBe(false)
    expect(calls.debug.map((event) => `${event.type}:${event.status}`)).toEqual([
      "server-event:received",
      "sync:succeeded",
    ])
    expect(calls.debug.at(-1)?.details).toContainEqual({ key: "reason", value: "ignore-stale" })
  })

  test("routes resource update events through cache and resource refetch actions", () => {
    const calls = recorder()

    syncArchitectureServerEvent({
      ...baseInput(calls),
      event: {
        type: "architecture.resource.updated",
        data: { resourceID: "design", revision: 2, digest: "saved-next" },
      },
      snapshot: () => snapshot(1, "saved-old"),
      resources: [{ id: "design", name: "Design", revision: 1, digest: "saved-old", nodes: 0, edges: 0 }],
    })

    expect(calls.refetchResources).toBe(1)
    expect(calls.refetchResource).toEqual(["design"])
    expect(calls.setInstance).toEqual(["design"])
    expect(calls.debug.at(-1)?.details).toContainEqual({ key: "reason", value: "refetch-resource" })
  })

  test("routes resource removal through one panel-owned cleanup action", () => {
    const calls = recorder()

    syncArchitectureServerEvent({
      ...baseInput(calls),
      event: { type: "architecture.resource.removed", data: { resourceID: "design" } },
    })

    expect(calls.removed).toEqual(["design"])
    expect(calls.refetchResource).toEqual([])
    expect(calls.debug.at(-1)?.details).toContainEqual({ key: "reason", value: "removed" })
  })
})

function baseInput(calls: ReturnType<typeof recorder>) {
  return {
    server: "http://localhost:4096",
    directory: "/repo",
    selectedResourceID: "design",
    localDirty: false,
    resources: [] as ArchitectureListResourcesOutput["data"],
    cacheOrder: createArchitectureCacheOrder(),
    snapshot: () => snapshot(0, "saved"),
    currentInstance: () => undefined,
    loadInstance: async () => live("external"),
    setInstance: (resourceID: string) => calls.setInstance.push(resourceID),
    refetchResources: () => {
      calls.refetchResources += 1
    },
    refetchResource: (resourceID: string) => calls.refetchResource.push(resourceID),
    removeResource: (resourceID: string) => calls.removed.push(resourceID),
    debug: (event: ArchitectureRuntimeDebugEvent) => calls.debug.push(event),
  }
}

function recorder() {
  return {
    debug: [] as ArchitectureRuntimeDebugEvent[],
    setInstance: [] as string[],
    refetchResources: 0,
    refetchResource: [] as string[],
    removed: [] as string[],
  }
}

function snapshot(revision = 1, digest = "saved"): ArchitectureSnapshot {
  return {
    digest,
    storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
    resource: { version: 2, revision, id: "design", name: "Design", nodes: [], edges: [] },
  }
}

function live(digest: string): ArchitectureLiveInstance {
  return { source: "live", snapshot: snapshot(1, digest) }
}
