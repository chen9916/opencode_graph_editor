import { describe, expect, test } from "bun:test"
import type { ArchitectureLiveInstance, ArchitectureLiveInstanceCache, ArchitectureSnapshot } from "./contract"
import { architectureJournalDebugEvent, prependArchitectureRuntimeDebugEvent } from "./runtime-debug"
import {
  architectureFetchedLiveInstanceEventPlan,
  architectureLiveInstanceEventPlan,
  architectureResourceEventRefreshPlan,
} from "./sync-events"

const snapshot = (revision = 2, digest = "digest"): ArchitectureSnapshot => ({
  digest,
  storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
  resource: { version: 2, revision, id: "design", name: "Design", nodes: [], edges: [] },
})

const live = (revision = 2, digest = "live"): ArchitectureLiveInstance => ({ source: "live", snapshot: snapshot(revision, digest) })

describe("architecture sync event helpers", () => {
  test("plans stale, discarded, and refetch instance event handling", () => {
    expect(
      architectureLiveInstanceEventPlan({
        snapshot: snapshot(3),
        event: { resourceID: "design", action: "updated", baseRevision: 2, baseDigest: "digest" },
      }).action,
    ).toBe("ignore-stale")
    expect(
      architectureLiveInstanceEventPlan({
        snapshot: snapshot(2),
        event: { resourceID: "design", action: "discarded", revision: 2, digest: "digest" },
      }),
    ).toEqual({ action: "adopt-cache", cache: null })
    expect(
      architectureLiveInstanceEventPlan({ snapshot: undefined, event: { resourceID: "design", action: "updated" } }).action,
    ).toBe("refetch")
  })

  test("plans authoritative adoption for metadata-only instance refetches", () => {
    expect(
      architectureFetchedLiveInstanceEventPlan({
        event: { resourceID: "design", action: "updated", revision: 2, digest: "event" },
        cache: live(2, "event"),
      }),
    ).toMatchObject({ action: "adopt-cache", reason: "live-response" })
    expect(
      architectureFetchedLiveInstanceEventPlan({
        event: { resourceID: "design", action: "updated", revision: 2, digest: "event" },
        cache: live(2, "other-same-revision"),
      }),
    ).toEqual({ action: "ignore", reason: "digest-mismatch" })
    expect(
      architectureFetchedLiveInstanceEventPlan({
        event: { resourceID: "design", action: "updated", revision: 3, digest: "event" },
        cache: live(2, "older"),
      }),
    ).toEqual({ action: "ignore", reason: "older-than-event" })
    expect(
      architectureFetchedLiveInstanceEventPlan({
        event: { resourceID: "design", action: "updated", revision: 2, digest: "event" },
        cache: null satisfies ArchitectureLiveInstanceCache,
      }),
    ).toEqual({ action: "ignore", reason: "saved-response" })
  })

  test("plans resource refetches without overriding dirty selected resources", () => {
    expect(
      architectureResourceEventRefreshPlan({
        eventType: "architecture.resource.updated",
        currentResourceID: "design",
        localDirty: true,
        resources: [],
        snapshot: undefined,
        event: { resourceID: "design", revision: 2, digest: "next" },
      }),
    ).toMatchObject({ updateResources: false, updateResource: false, clearLiveInstance: false })
    expect(
      architectureResourceEventRefreshPlan({
        eventType: "architecture.resource.removed",
        currentResourceID: "design",
        localDirty: false,
        resources: [],
        snapshot: undefined,
        event: { resourceID: "design" },
      }),
    ).toMatchObject({ removed: true, clearLocalState: true })
  })

  test("allows selected resource refetches when only external live state is dirty", () => {
    expect(
      architectureResourceEventRefreshPlan({
        eventType: "architecture.resource.updated",
        currentResourceID: "design",
        localDirty: false,
        resources: [],
        snapshot: snapshot(2, "previous"),
        event: { resourceID: "design", revision: 3, digest: "next" },
      }),
    ).toMatchObject({ updateResources: true, updateResource: true, clearLiveInstance: true })
  })

  test("builds bounded debug event history with operation type summaries", () => {
    const event = architectureJournalDebugEvent({
      server: "http://localhost:4096",
      directory: "/repo",
      base: snapshot(),
      origin: snapshot(),
      resource: snapshot().resource,
      operations: [
        { id: "move", type: "node.position", nodeID: "node", position: { x: 1, y: 2 } },
        { id: "remove", type: "node.remove", nodeID: "other", cascade: true },
      ],
      conflicts: [],
    })

    expect(event.operationTypes).toEqual(["node.position", "node.remove"])
    expect(prependArchitectureRuntimeDebugEvent([event], event, 1)).toEqual([event])
  })
})
