import { describe, expect, test } from "bun:test"
import type { ArchitectureOperation, ArchitectureResource, ArchitectureRuntimeView, ArchitectureSnapshot } from "./contract"
import { architectureCanvasSourceDebugEvent } from "./runtime-debug"
import { createArchitectureEditorHistory } from "./editor-state"
import { syncArchitectureCanvasSource, type ArchitectureCanvasSourceMetadata } from "./canvas-source-sync"

const resource = (input: {
  readonly id?: string
  readonly revision?: number
  readonly text?: string
} = {}): ArchitectureResource => ({
  version: 2,
  revision: input.revision ?? 1,
  id: input.id ?? "design",
  name: "Design",
  nodes: [{ id: "node", text: input.text ?? "Saved", tags: [], layout: { position: { x: 0, y: 0 } } }],
  edges: [],
})

const snapshot = (input: {
  readonly id?: string
  readonly revision?: number
  readonly digest?: string
  readonly text?: string
} = {}): ArchitectureSnapshot => ({
  digest: input.digest ?? `${input.id ?? "design"}-${input.revision ?? 1}`,
  storage: { root: "/repo/.opencode/architecture", path: `.opencode/architecture/resources/${input.id ?? "design"}.json` },
  resource: resource(input),
})

const view = (value: ArchitectureSnapshot, source: "saved" | "live" = "saved"): ArchitectureRuntimeView => ({
  selectedResourceID: value.resource.id,
  snapshot: value,
  visibleSnapshot: value,
  visibleResource: value.resource,
  pendingCovered: false,
  dirty: source === "live",
  dirtyReasons: source === "live" ? ["live-instance"] : [],
  operationCount: 0,
  conflictCount: 0,
  hasLiveInstance: source === "live",
  savedRevision: value.resource.revision,
  savedDigest: source === "live" ? "saved" : value.digest,
  visibleRevision: value.resource.revision,
  visibleDigest: value.digest,
  syncStatus: source === "live" ? "live-instance" : "clean",
  conflictExplanations: [],
  debugEvents: [],
})

const previous = (value: ArchitectureSnapshot, source: "saved" | "live" = "saved"): ArchitectureCanvasSourceMetadata => ({
  resourceID: value.resource.id,
  revision: value.resource.revision,
  digest: value.digest,
  source,
})

const addNode: ArchitectureOperation = {
  id: "add-local",
  type: "node.create",
  node: { id: "local", text: "Local", tags: [], layout: { position: { x: 120, y: 0 } } },
}

describe("architecture canvas source sync", () => {
  test("describes initial mount without graph content", () => {
    const saved = snapshot({ digest: "saved" })
    const synced = syncArchitectureCanvasSource({
      history: createArchitectureEditorHistory(saved.resource, []),
      source: saved.resource,
      operations: [],
      snapshot: saved,
      runtimeView: view(saved),
    })

    expect(synced.transition).toMatchObject({ action: "initial", reason: "initial-mount", source: "saved" })
    expect(synced.history.resource).toEqual(saved.resource)
    expect(architectureCanvasSourceDebugEvent(synced.transition).details).toEqual([
      { key: "action", value: "initial" },
      { key: "source", value: "saved" },
      { key: "reason", value: "initial-mount" },
      { key: "resourceID", value: "design" },
      { key: "toRevision", value: 1 },
      { key: "toDigest", value: "saved" },
    ])
  })

  test("accepts a newer visible live digest", () => {
    const saved = snapshot({ revision: 1, digest: "saved" })
    const live = snapshot({ revision: 2, digest: "live", text: "AI" })
    const synced = syncArchitectureCanvasSource({
      history: createArchitectureEditorHistory(saved.resource, []),
      source: live.resource,
      operations: [],
      snapshot: live,
      runtimeView: view(live, "live"),
      previous: previous(saved),
    })

    expect(synced.transition).toMatchObject({ action: "replace", reason: "newer-source", source: "live" })
    expect(synced.history.resource.nodes[0]?.text).toBe("AI")
  })

  test("accepts a same-revision digest change", () => {
    const saved = snapshot({ revision: 3, digest: "saved" })
    const live = snapshot({ revision: 3, digest: "same-revision-live", text: "AI" })
    const synced = syncArchitectureCanvasSource({
      history: createArchitectureEditorHistory(saved.resource, []),
      source: live.resource,
      operations: [],
      snapshot: live,
      runtimeView: view(live, "live"),
      previous: previous(saved),
    })

    expect(synced.transition).toMatchObject({ action: "replace", reason: "same-revision-digest-change" })
  })

  test("identifies an authoritative live source even when it matches the saved metadata", () => {
    const saved = snapshot({ revision: 3, digest: "same" })
    const synced = syncArchitectureCanvasSource({
      history: createArchitectureEditorHistory(saved.resource, []),
      source: saved.resource,
      operations: [],
      snapshot: saved,
      runtimeView: { ...view(saved, "live"), savedDigest: saved.digest },
      previous: previous(saved),
    })

    expect(synced.transition).toMatchObject({ action: "replace", reason: "source-change", source: "live" })
  })

  test("replaces on resource switch", () => {
    const first = snapshot({ id: "first", digest: "first" })
    const second = snapshot({ id: "second", digest: "second" })
    const synced = syncArchitectureCanvasSource({
      history: createArchitectureEditorHistory(first.resource, []),
      source: second.resource,
      operations: [],
      snapshot: second,
      runtimeView: view(second),
      previous: previous(first),
    })

    expect(synced.transition).toMatchObject({ action: "replace", reason: "resource-switch", resourceID: "second" })
    expect(synced.history.resource.id).toBe("second")
  })

  test("rebases pending operations onto the incoming source", () => {
    const saved = snapshot({ digest: "saved" })
    const live = snapshot({ revision: 2, digest: "live", text: "AI" })
    const synced = syncArchitectureCanvasSource({
      history: createArchitectureEditorHistory(saved.resource, [addNode]),
      source: live.resource,
      operations: [addNode],
      snapshot: live,
      runtimeView: view(live, "live"),
      previous: previous(saved),
    })

    expect(synced.transition).toMatchObject({ action: "rebase", reason: "pending-rebase" })
    expect(synced.history.resource.nodes.map((node) => node.id)).toEqual(["node", "local"])
    expect(synced.history.source.nodes[0]?.text).toBe("AI")
  })

  test("keeps unchanged source quiet", () => {
    const saved = snapshot({ digest: "saved" })
    const synced = syncArchitectureCanvasSource({
      history: createArchitectureEditorHistory(saved.resource, []),
      source: saved.resource,
      operations: [],
      snapshot: saved,
      runtimeView: view(saved),
      previous: previous(saved),
    })

    expect(synced.transition).toMatchObject({ action: "unchanged", reason: "unchanged" })
  })
})
