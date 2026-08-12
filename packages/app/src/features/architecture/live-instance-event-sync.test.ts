import { describe, expect, test } from "bun:test"
import type { ArchitectureLiveInstance, ArchitectureLiveInstanceCache, ArchitectureRuntimeDebugEvent } from "./contract"
import { syncArchitectureLiveInstanceEventRefetch } from "./live-instance-event-sync"

describe("architecture live instance event sync", () => {
  test("adopts same-revision metadata-only event refetches authoritatively", async () => {
    let current: ArchitectureLiveInstanceCache = live("current")
    const events: ArchitectureRuntimeDebugEvent[] = []

    await syncArchitectureLiveInstanceEventRefetch({
      event: { resourceID: "design", action: "updated", revision: 1, digest: "external" },
      current: () => current,
      observe: async () => live("external"),
      update: (next) => {
        current = next(current) ?? current
      },
      debug: (event) => events.push(event),
    })

    expect(current?.snapshot.digest).toBe("external")
    expect(events.map((event) => `${event.type}:${event.status}`)).toEqual(["sync:started", "sync:succeeded"])
    expect(events.at(-1)?.details).toContainEqual({ key: "reason", value: "live-response" })
  })

  test("keeps current cache when an event refetch returns a different same-revision digest", async () => {
    let current: ArchitectureLiveInstanceCache = live("current")
    const events: ArchitectureRuntimeDebugEvent[] = []

    await syncArchitectureLiveInstanceEventRefetch({
      event: { resourceID: "design", action: "updated", revision: 1, digest: "external" },
      current: () => current,
      observe: async () => live("stale"),
      update: (next) => {
        current = next(current) ?? current
      },
      debug: (event) => events.push(event),
    })

    expect(current?.snapshot.digest).toBe("current")
    expect(events.map((event) => `${event.type}:${event.status}`)).toEqual(["sync:started", "sync:failed"])
    expect(events.at(-1)?.details).toContainEqual({ key: "reason", value: "digest-mismatch" })
  })
})

function live(digest: string): ArchitectureLiveInstance {
  return {
    source: "live",
    snapshot: {
      digest,
      storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
      resource: { version: 2, revision: 1, id: "design", name: "Design", nodes: [], edges: [] },
    },
  }
}
