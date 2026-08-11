import { describe, expect, test } from "bun:test"
import type { ArchitectureLiveDraft } from "./contract"
import {
  architectureDraftEventIsStale,
  architectureResourceEventInfo,
  architectureResourceDraftEventCache,
  architectureResourceDraftEventInfo,
  architectureSnapshotCoversEvent,
  architectureSnapshotMatchesEvent,
  architectureSummaryMatchesEvent,
  beginArchitectureLocalDraftOperation,
  beginArchitectureLocalSave,
  captureArchitectureLocalDraftOperationEvent,
  isArchitectureLocalSaveEvent,
  rememberArchitectureLocalDraftOperationEvent,
} from "./event"

describe("architecture resource events", () => {
  test("reads legacy properties and current data payloads", () => {
    expect(
      architectureResourceEventInfo({
        type: "architecture.resource.updated",
        properties: { resourceID: "design", revision: 2, digest: "abc" },
      }),
    ).toEqual({ resourceID: "design", revision: 2, digest: "abc" })

    expect(
      architectureResourceEventInfo({
        type: "architecture.resource.updated",
        data: { resourceID: "design", revision: 3, digest: "def" },
      }),
    ).toEqual({ resourceID: "design", revision: 3, digest: "def" })
  })

  test("keeps live draft events out of saved resource reconciliation", () => {
    expect(
      architectureResourceEventInfo({
        type: "architecture.resource.draft.updated",
        properties: { resourceID: "design", revision: 2, digest: "live" },
      }),
    ).toBeUndefined()
  })

  test("detects resource list and snapshot freshness", () => {
    const event = { resourceID: "design", revision: 2, digest: "abc" }
    expect(
      architectureSummaryMatchesEvent(
        [{ id: "design", name: "Design", revision: 2, digest: "abc", nodes: 1, edges: 0 }],
        event,
      ),
    ).toBe(true)
    expect(
      architectureSummaryMatchesEvent(
        [{ id: "design", name: "Design", revision: 1, digest: "old", nodes: 1, edges: 0 }],
        event,
      ),
    ).toBe(false)
    expect(
      architectureSnapshotMatchesEvent(
        {
          resource: { version: 2, id: "design", name: "Design", revision: 2, nodes: [], edges: [] },
          digest: "abc",
          storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
        },
        event,
      ),
    ).toBe(true)
    expect(
      architectureSnapshotCoversEvent(
        {
          resource: { version: 2, id: "design", name: "Design", revision: 3, nodes: [], edges: [] },
          digest: "newer",
          storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
        },
        event,
      ),
    ).toBe(true)
  })

  test("retains the newest concurrent saved event suppressed during a local save", () => {
    const finish = beginArchitectureLocalSave({
      server: "http://127.0.0.1:4096",
      directory: "C:/repo",
      resourceID: "design",
    })

    expect(
      isArchitectureLocalSaveEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event: { resourceID: "design", revision: 2, digest: "s1" },
      }),
    ).toBe(true)
    expect(
      isArchitectureLocalSaveEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event: { resourceID: "design", revision: 3, digest: "s2" },
      }),
    ).toBe(true)

    expect(finish()).toEqual({ resourceID: "design", revision: 3, digest: "s2" })
    expect(finish()).toBeUndefined()

    expect(
      isArchitectureLocalSaveEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event: { resourceID: "design", revision: 2, digest: "abc" },
      }),
    ).toBe(false)
  })

  test("captures draft events during a local save or reload without exposing them to the live synchronizer", () => {
    const finish = beginArchitectureLocalDraftOperation({
      server: "http://127.0.0.1:4096",
      directory: "C:/repo",
      resourceID: "design",
      operation: "save",
    })
    const event = { resourceID: "design", action: "discarded" as const, revision: 2, digest: "saved" }

    expect(
      captureArchitectureLocalDraftOperationEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event,
      }),
    ).toBe(true)

    expect(finish()).toEqual(event)
    expect(finish()).toBeUndefined()
    expect(
      captureArchitectureLocalDraftOperationEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event,
      }),
    ).toBe(false)
  })

  test("suppresses late draft echo events after the local patch response settles", () => {
    const event = { resourceID: "design", action: "updated" as const, revision: 4, digest: "draft" }
    rememberArchitectureLocalDraftOperationEvent({
      server: "http://127.0.0.1:4096",
      directory: "C:/repo",
      event,
    })

    expect(
      captureArchitectureLocalDraftOperationEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event,
      }),
    ).toBe(true)
    expect(
      captureArchitectureLocalDraftOperationEvent({
        server: "http://127.0.0.1:4096",
        directory: "C:/repo",
        event: { ...event, digest: "external" },
      }),
    ).toBe(false)
  })

  test("reads live draft update events with inline or nested draft payloads", () => {
    const draft: ArchitectureLiveDraft = {
      source: "live",
      snapshot: {
        digest: "live",
        storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
        resource: { version: 2, revision: 4, id: "design", name: "Design draft", nodes: [], edges: [] },
      },
    }

    expect(
      architectureResourceDraftEventInfo({
        type: "architecture.resource.draft.updated",
        data: { resourceID: "design", ...draft },
      }),
    ).toEqual({ resourceID: "design", action: "updated", draft })

    expect(
      architectureResourceDraftEventInfo({
        type: "architecture.resource.draft.discarded",
        properties: { resourceID: "design", draft },
      }),
    ).toEqual({ resourceID: "design", action: "discarded", draft })
  })

  test("uses data payload fields when a legacy properties object is also present", () => {
    expect(
      architectureResourceDraftEventInfo({
        type: "architecture.resource.draft.updated",
        properties: {},
        data: {
          resourceID: "design",
          revision: 5,
          digest: "data-digest",
          baseRevision: 4,
          baseDigest: "base-digest",
        },
      }),
    ).toEqual({
      resourceID: "design",
      action: "updated",
      revision: 5,
      digest: "data-digest",
      baseRevision: 4,
      baseDigest: "base-digest",
      draft: undefined,
    })
  })

  test("reads metadata-only draft events without pretending they include a draft", () => {
    expect(
      architectureResourceDraftEventInfo({
        type: "architecture.resource.draft.updated",
        data: {
          resourceID: "design",
          revision: 4,
          digest: "live",
          baseRevision: 2,
          baseDigest: "saved",
        },
      }),
    ).toEqual({
      resourceID: "design",
      action: "updated",
      revision: 4,
      digest: "live",
      baseRevision: 2,
      baseDigest: "saved",
      draft: undefined,
    })
  })

  test("detects stale draft events after a newer saved snapshot", () => {
    const saved = {
      resource: { version: 2 as const, id: "design", name: "Design", revision: 3, nodes: [], edges: [] },
      digest: "saved",
      storage: { root: "/repo/.opencode/architecture", path: ".opencode/architecture/resources/design.json" },
    }

    expect(
      architectureDraftEventIsStale(saved, {
        resourceID: "design",
        action: "updated",
        revision: 2,
        digest: "live",
        baseRevision: 2,
        baseDigest: "old",
      }),
    ).toBe(true)
    expect(
      architectureDraftEventIsStale(saved, {
        resourceID: "design",
        action: "discarded",
        revision: 2,
        digest: "old",
      }),
    ).toBe(true)
    expect(
      architectureDraftEventIsStale(saved, {
        resourceID: "design",
        action: "updated",
        revision: 3,
        digest: "live",
        baseRevision: 3,
        baseDigest: "saved",
      }),
    ).toBe(false)
  })

  test("maps discard events to an explicit empty draft cache value", () => {
    expect(architectureResourceDraftEventCache({ resourceID: "design", action: "discarded" })).toBeNull()
  })
})
